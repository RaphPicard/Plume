#include <zephyr/kernel.h>
#include <zephyr/device.h>
#include <zephyr/drivers/uart.h>
#include <zephyr/drivers/sensor.h>
#include <zephyr/sys/atomic.h>
#include <zephyr/devicetree.h>
#include <string.h>
#include <stdio.h>

/* ── Périphériques ──────────────────────────────────────────────────────── */
#define SERIALIZER_DEV DT_NODELABEL(uart4)
#define ACCEL_NODE     DT_NODELABEL(adxl345)

/* ── Paramètres du test ─────────────────────────────────────────────────── */
#define TEST_VELOCITY      50    /* Vitesse d'avance (0–127 selon votre Serializer) */
#define RESUME_DELAY_MS  2000    /* Pause après un choc avant de reprendre (ms)     */
#define LOG_INTERVAL_MS   200    /* Affichage des valeurs brutes toutes les N ms    */

/* ── Seuils de détection (en m/s²) ─────────────────────────────────────── */
/*
 * Commencez avec des seuils larges, puis réduisez-les selon vos essais.
 * Valeurs typiques au repos (ADXL345 à plat) :
 *   X ≈ 0, Y ≈ 0, Z ≈ 9.81
 * Un petit coup de main génère typiquement 3–6 m/s² sur l'axe concerné.
 */
#define THRESHOLD_X  8.0f   /* Choc frontal / arrière  */
#define THRESHOLD_Y  8.0f   /* Choc latéral            */
#define THRESHOLD_Z  8.0f   /* Seuil appliqué sur (Z - 9.81), choc vertical */

/* ── Threads ────────────────────────────────────────────────────────────── */
#define ACCEL_STACK_SIZE 1024
#define ACCEL_PRIORITY      5

K_THREAD_STACK_DEFINE(accel_stack_area, ACCEL_STACK_SIZE);
static struct k_thread accel_thread_data;

/* ── Partage d'état entre threads ──────────────────────────────────────── */
static const struct device *serializer;
static const struct device *accel_dev;

K_MUTEX_DEFINE(serializer_mutex);

/*
 * État du robot partagé entre les deux threads :
 *   0 = arrêté / en pause après choc
 *   1 = en marche
 */
static atomic_t robot_running = ATOMIC_INIT(0);

/*
 * Drapeau levé par le thread accéléromètre pour signaler un choc.
 * Le thread principal le lit, attend RESUME_DELAY_MS, puis reprend.
 */
static atomic_t shock_detected = ATOMIC_INIT(0);

/* ── Helpers ────────────────────────────────────────────────────────────── */

/* Affiche un float avec 2 décimales sans %f (compatible printk Zephyr) */
static void print_float(const char *prefix, float val, const char *suffix)
{
    int sign    = (val < 0.0f) ? -1 : 1;
    float abs_v = (val < 0.0f) ? -val : val;
    int integer = (int)abs_v;
    int frac    = (int)((abs_v - (float)integer) * 100.0f);

    if (sign < 0) {
        printk("%s-%d.%02d%s", prefix, integer, frac, suffix);
    } else {
        printk("%s%d.%02d%s", prefix, integer, frac, suffix);
    }
}

/* Envoie une commande ASCII au Serializer via UART */
static void robot_send_cmd(const char *cmd)
{
    size_t len = strlen(cmd);
    k_mutex_lock(&serializer_mutex, K_FOREVER);
    for (int i = 0; i < (int)len; i++) {
        uart_poll_out(serializer, cmd[i]);
    }
    uart_poll_out(serializer, '\r');
    k_mutex_unlock(&serializer_mutex);
}

/* Démarre l'avance à TEST_VELOCITY sur les deux moteurs */
static void robot_go_forward(void)
{
    char cmd[32];
    snprintf(cmd, sizeof(cmd), "mogo 1:%d 2:%d;", TEST_VELOCITY, TEST_VELOCITY);
    robot_send_cmd(cmd);
    atomic_set(&robot_running, 1);
    printk("[MOTEURS] Avance (vitesse=%d)\n", TEST_VELOCITY);
}

/* Arrête les moteurs immédiatement */
static void robot_stop(void)
{
    robot_send_cmd("stop");
    atomic_set(&robot_running, 0);
}

/* ── Thread accéléromètre ───────────────────────────────────────────────── */
/*
 * Tourne à 50 Hz (toutes les 20 ms).
 * Affiche les valeurs brutes toutes les LOG_INTERVAL_MS pour le suivi en live.
 * Si un seuil est franchi, stoppe le robot et lève shock_detected.
 */
static void accel_thread_main(void *p1, void *p2, void *p3)
{
    ARG_UNUSED(p1); ARG_UNUSED(p2); ARG_UNUSED(p3);

    struct sensor_value accel[3];
    uint32_t last_log = 0;

    printk("[ACCEL] Thread démarré. Surveillance active.\n");
    printk("[ACCEL] Seuils : X=+/-%.0f  Y=+/-%.0f  Z(delta)+/-%.0f m/s2\n",
           (double)THRESHOLD_X, (double)THRESHOLD_Y, (double)THRESHOLD_Z);

    while (1) {
        /* Lecture de l'accéléromètre */
        if (sensor_sample_fetch(accel_dev) < 0) {
            printk("[ACCEL] ERREUR fetch ADXL345\n");
            k_msleep(20);
            continue;
        }
        sensor_channel_get(accel_dev, SENSOR_CHAN_ACCEL_XYZ, accel);

        float x = sensor_value_to_float(&accel[0]);
        float y = sensor_value_to_float(&accel[1]);
        float z = sensor_value_to_float(&accel[2]);
        float dz = z - 23.0f;   /* Composante dynamique sur Z */

        /* ── Log périodique des valeurs brutes ──────────────────────────── */
        uint32_t now = k_uptime_get_32();
        if ((now - last_log) >= LOG_INTERVAL_MS) {
            last_log = now;
            /* Formatage sur une seule ligne pour faciliter le copier-coller */
            printk("[DATA] X=");
            print_float("", x, "  Y=");
            print_float("", y, "  Z=");
            print_float("", z, "  dZ=");
            print_float("", dz, " m/s2\n");
        }

        /* ── Détection de choc ──────────────────────────────────────────── */
        /*
         * On ne détecte un choc que si le robot est en marche.
         * (Évite les fausses alertes à l'arrêt ou pendant la pause.)
         */
        if (!atomic_get(&robot_running)) {
            k_msleep(20);
            continue;
        }

        const char *axe   = NULL;
        float       val   = 0.0f;
        float       seuil = 0.0f;

        if (x > THRESHOLD_X || x < -THRESHOLD_X) {
            axe   = "X (frontal/arriere)";
            val   = x;
            seuil = THRESHOLD_X;
        } else if (y > THRESHOLD_Y || y < -THRESHOLD_Y) {
            axe   = "Y (lateral)";
            val   = y;
            seuil = THRESHOLD_Y;
        } else if (dz > THRESHOLD_Z || dz < -THRESHOLD_Z) {
            axe   = "Z (vertical)";
            val   = dz;
            seuil = THRESHOLD_Z;
        }

        if (axe != NULL) {
            robot_stop();
            printk("\n========================================\n");
            printk("  *** CHOC DETECTE sur axe %s ***\n", axe);
            print_float("  Valeur mesurée : ", val,   " m/s2\n");
            print_float("  Seuil         : ", seuil,  " m/s2\n");
            printk("  Robot arrêté. Reprise dans %d ms...\n", RESUME_DELAY_MS);
            printk("========================================\n\n");

            /* Signale au thread principal pour qu'il gère la reprise */
            atomic_set(&shock_detected, 1);
        }

        k_msleep(20); /* 50 Hz */
    }
}

/* ── Main ───────────────────────────────────────────────────────────────── */
int main(void)
{
    /* 1. Initialisation des périphériques */
    serializer = DEVICE_DT_GET(SERIALIZER_DEV);
    accel_dev  = DEVICE_DT_GET(ACCEL_NODE);

    if (!device_is_ready(serializer)) {
        printk("[ERREUR] Serializer (uart4) non prêt\n");
        return 0;
    }
    if (!device_is_ready(accel_dev)) {
        printk("[ERREUR] ADXL345 non prêt\n");
        return 0;
    }

    printk("\n=== TEST ACCELEROMETRE ADXL345 ===\n");
    printk("Lancement du thread accéléromètre...\n");

    /* 2. Lancement du thread accéléromètre */
    k_tid_t accel_tid = k_thread_create(
        &accel_thread_data, accel_stack_area,
        K_THREAD_STACK_SIZEOF(accel_stack_area),
        accel_thread_main, NULL, NULL, NULL,
        ACCEL_PRIORITY, 0, K_NO_WAIT);
    k_thread_name_set(accel_tid, "accel_test");

    /* Petite pause pour laisser le thread démarrer et afficher son header */
    k_sleep(K_MSEC(500));

    /* 3. Mise en marche initiale */
    printk("[MAIN] Démarrage de l'avance automatique.\n");
    printk("[MAIN] Donnez des petits coups au robot pour tester les seuils.\n\n");
    robot_go_forward();

    /* 4. Boucle principale : gère uniquement la reprise après choc */
    while (1) {
        if (atomic_cas(&shock_detected, 1, 0)) {
            /*
             * Un choc a été détecté par le thread accéléromètre.
             * On attend RESUME_DELAY_MS puis on reprend l'avance.
             * Pendant cette pause, les logs de l'accéléromètre continuent.
             */
            k_msleep(RESUME_DELAY_MS);

            printk("[MAIN] Reprise de l'avance après choc.\n\n");
            robot_go_forward();
        }

        k_msleep(50); /* Cadence de vérification de la boucle principale */
    }

    return 0;
}
