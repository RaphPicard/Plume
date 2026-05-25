#include <zephyr/kernel.h>
#include <zephyr/device.h>
#include <zephyr/drivers/uart.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/drivers/sensor.h>
#include <zephyr/sys/atomic.h>
#include <string.h>
#include <stdio.h>
#include <zephyr/devicetree.h>

#define SERIALIZER_DEV DT_NODELABEL(uart4)
#define RPI_UART_DEV   DT_NODELABEL(uart5)
#define GPIOA_NODE     DT_NODELABEL(gpioa)
#define ACCEL_NODE     DT_NODELABEL(adxl345)
#define BUTTON_NODE    DT_ALIAS(sw0)

#define RX_BUF_SIZE          64
#define CHOC_THRESHOLD_Z     8.0f
#define CHOC_THRESHOLD_X     8.0f
#define CHOC_THRESHOLD_Y     8.0f
#define UART_READ_TIMEOUT_MS 100

static const struct device        *serializer, *gpioa, *accel_dev;
static const struct device        *rpi_uart;
static const struct gpio_dt_spec   button = GPIO_DT_SPEC_GET(BUTTON_NODE, gpios);

static atomic_t is_moving_forward  = ATOMIC_INIT(0);
static atomic_t shared_distance_cm = ATOMIC_INIT(999);

K_MUTEX_DEFINE(serializer_mutex);
K_MUTEX_DEFINE(rpi_uart_mutex);     /* protection uart5 partagé entre threads */

/* ── Stacks des threads ───────────────────────────────────────────────── */
#define ACCEL_STACK_SIZE   1024
#define ACCEL_PRIORITY        5
#define SONAR_STACK_SIZE   1024
#define SONAR_PRIORITY        6
#define BUTTON_STACK_SIZE   512
#define BUTTON_PRIORITY       4   /* priorité plus haute : réactivité bouton */

K_THREAD_STACK_DEFINE(accel_stack_area,  ACCEL_STACK_SIZE);
K_THREAD_STACK_DEFINE(sonar_stack_area,  SONAR_STACK_SIZE);
K_THREAD_STACK_DEFINE(button_stack_area, BUTTON_STACK_SIZE);

struct k_thread accel_thread_data;
struct k_thread sonar_thread_data;
struct k_thread button_thread_data;

/* ════════════════════════════════════════════════════════════════════════
 *  Utilitaires
 * ════════════════════════════════════════════════════════════════════════ */

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

/* ════════════════════════════════════════════════════════════════════════
 *  Envoi UART
 * ════════════════════════════════════════════════════════════════════════ */

static void uart_send_raw(const struct device *dev, const char *msg)
{
    for (int i = 0; msg[i] != '\0'; i++) {
        uart_poll_out(dev, msg[i]);
    }
}

static void robot_send_cmd(const struct device *dev, const char *cmd)
{
    printk("[SERIAL→] '%s\r'\n", cmd);  /* log avant envoi */
    size_t len = strlen(cmd);
    for (int i = 0; i < (int)len; i++) {
        uart_poll_out(dev, cmd[i]);
    }
    uart_poll_out(dev, '\r');
}

/* Envoi vers RPi (uart5) — protégé mutex */
static void rpi_send(const char *msg)
{
    k_mutex_lock(&rpi_uart_mutex, K_FOREVER);
    uart_send_raw(rpi_uart, msg);
    k_mutex_unlock(&rpi_uart_mutex);
    printk("[TX→RPi] %s", msg);
}

/* ════════════════════════════════════════════════════════════════════════
 *  Commandes moteurs
 * ════════════════════════════════════════════════════════════════════════ */

static void safe_stop(void)
{
    k_mutex_lock(&serializer_mutex, K_FOREVER);
    robot_send_cmd(serializer, "stop");
    k_mutex_unlock(&serializer_mutex);
    atomic_set(&is_moving_forward, 0);
    printk("[MOTOR] STOP (safe)\n");
}

void set_motors(const struct device *uart_dev, int left_velocity, int right_velocity)
{
    char cmd[64];
    snprintf(cmd, sizeof(cmd), "mogo 1:%d 2:%d;", left_velocity, right_velocity);

    k_mutex_lock(&serializer_mutex, K_FOREVER);
    robot_send_cmd(uart_dev, cmd);
    k_mutex_unlock(&serializer_mutex);

    atomic_set(&is_moving_forward,
               (left_velocity > 0 && right_velocity > 0) ? 1 : 0);

    printk("[MOTOR] L=%d R=%d\n", left_velocity, right_velocity);
    printk("[MOTOR] set_motors L=%d R=%d → cmd='%s'\n", left_velocity, right_velocity, cmd);
}

void stop(const struct device *uart_dev)
{
    k_mutex_lock(&serializer_mutex, K_FOREVER);
    robot_send_cmd(uart_dev, "stop");
    k_mutex_unlock(&serializer_mutex);
    atomic_set(&is_moving_forward, 0);
    printk("[MOTOR] STOP\n");
}

/* ════════════════════════════════════════════════════════════════════════
 *  Parsing / exécution commandes RPi
 * ════════════════════════════════════════════════════════════════════════ */

int uart_read_line(const struct device *dev, int first_char,
                   char *buf, int max_len, uint32_t timeout_ms)
{
    int idx = 0;
    unsigned char c;

    if (first_char >= 0 && first_char != '\r' && first_char != '\n') {
        if (idx < max_len - 1) {
            buf[idx++] = (unsigned char)first_char;
        }
    }

    uint32_t deadline = k_uptime_get_32() + timeout_ms;

    while (1) {
        if (uart_poll_in(dev, &c) == 0) {
            if (c == '\r' || c == '\n') {
                if (idx > 0) {
                    buf[idx] = '\0';
                    return idx;
                }
            } else if (idx < max_len - 1) {
                buf[idx++] = c;
            }
        }

        if (k_uptime_get_32() >= deadline) {
            if (idx > 0) {
                buf[idx] = '\0';
                return idx;
            }
            return -1;
        }

        k_yield();
    }
}

typedef enum {
    CMD_FORWARD, CMD_BACKWARD, CMD_TURN_LEFT, CMD_TURN_RIGHT,
    CMD_STOP, CMD_UNKNOWN
} command_t;

typedef struct { command_t cmd; int v; int turn; } robot_command_t;

command_t parse_command(const char *str, int *v, int *turn)
{
    char cmd[16];
    *v    = 0;
    *turn = 0;
    int n = sscanf(str, "%15s %d %d", cmd, v, turn);

    if (n < 1) return CMD_UNKNOWN;

    if (strcmp(cmd, "FWD")  == 0) return CMD_FORWARD;
    if (strcmp(cmd, "BWD")  == 0) return CMD_BACKWARD;
    if (strcmp(cmd, "TR")   == 0) return CMD_TURN_RIGHT;
    if (strcmp(cmd, "TL")   == 0) return CMD_TURN_LEFT;
    if (strcmp(cmd, "STOP") == 0) return CMD_STOP;

    return CMD_UNKNOWN;
}

void execute_command(const struct device *uart_dev, robot_command_t *c)
{
    switch (c->cmd) {
        case CMD_FORWARD:
            set_motors(uart_dev,  c->v,              c->v);             break;
        case CMD_BACKWARD:
            set_motors(uart_dev, -c->v,             -c->v);             break;
        case CMD_TURN_LEFT:
            set_motors(uart_dev,  c->v + c->turn,    c->v - c->turn);   break;
        case CMD_TURN_RIGHT:
            set_motors(uart_dev,  c->v - c->turn,    c->v + c->turn);   break;
        case CMD_STOP:
            stop(uart_dev); break;
        default:
            printk("[CMD] Commande inconnue → STOP\n");
            stop(uart_dev); break;
    }
}

void process(const struct device *uart_dev, char *msg)
{
    robot_command_t cmd;
    int v = 0, turn = 0;

    cmd.cmd  = parse_command(msg, &v, &turn);
    cmd.v    = v;
    cmd.turn = turn;

    execute_command(uart_dev, &cmd);
}

/* ════════════════════════════════════════════════════════════════════════
 *  Thread : sonar HC-SR04
 * ════════════════════════════════════════════════════════════════════════ */

static uint32_t measure_distance_once(void)
{
    gpio_pin_set(gpioa, 8, 1);
    k_busy_wait(10);
    gpio_pin_set(gpioa, 8, 0);

    uint32_t timeout_rise = 20000u;
    while (!gpio_pin_get(gpioa, 9)) {
        if (timeout_rise-- == 0) return 999u;
        k_busy_wait(1);
    }
    uint32_t start = k_cycle_get_32();

    uint32_t timeout_fall = 20000u;
    while (gpio_pin_get(gpioa, 9)) {
        if (timeout_fall-- == 0) return 999u;
        k_busy_wait(1);
    }
    uint32_t end = k_cycle_get_32();

    uint32_t microseconds = k_cyc_to_us_floor32(end - start);
    return microseconds / 58u;
}

void sonar_thread_main(void *p1, void *p2, void *p3)
{
    ARG_UNUSED(p1); ARG_UNUSED(p2); ARG_UNUSED(p3);

    printk("[SONAR] Thread démarré\n");

    while (1) {
        uint32_t d = measure_distance_once();
        atomic_set(&shared_distance_cm, (atomic_val_t)d);

        if (d < 50u) {
            printk("[SONAR] Distance : %u cm\n", d);
        }

        k_msleep(50);
    }
}

/* ════════════════════════════════════════════════════════════════════════
 *  Thread : accéléromètre ADXL345
 * ════════════════════════════════════════════════════════════════════════ */

void accel_thread_main(void *p1, void *p2, void *p3)
{
    ARG_UNUSED(p1); ARG_UNUSED(p2); ARG_UNUSED(p3);

    printk("[ACCEL] Thread démarré\n");

    struct sensor_value accel[3];

    while (1) {
        if (sensor_sample_fetch(accel_dev) < 0) {
            printk("[ACCEL] Erreur fetch ADXL345\n");
            k_msleep(20);
            continue;
        }

        sensor_channel_get(accel_dev, SENSOR_CHAN_ACCEL_XYZ, accel);

        float x  = sensor_value_to_float(&accel[0]);
        float y  = sensor_value_to_float(&accel[1]);
        float z  = sensor_value_to_float(&accel[2]);
        float dz = z - 23.0f;

        if (x > CHOC_THRESHOLD_X || x < -CHOC_THRESHOLD_X) {
            safe_stop();
            print_float("[ACCEL] COLLISION X : ", x, " m/s2\n");
        } else if (y > CHOC_THRESHOLD_Y || y < -CHOC_THRESHOLD_Y) {
            safe_stop();
            print_float("[ACCEL] COLLISION Y : ", y, " m/s2\n");
        } else if (dz > CHOC_THRESHOLD_Z || dz < -CHOC_THRESHOLD_Z) {
            safe_stop();
            print_float("[ACCEL] PERTURBATION Z : ", z, " m/s2\n");
        }

        k_msleep(20);
    }
}

/* ════════════════════════════════════════════════════════════════════════
 *  Thread : bouton physique → CONFIRM vers RPi
 * ════════════════════════════════════════════════════════════════════════ */

void button_thread_main(void *p1, void *p2, void *p3)
{
    ARG_UNUSED(p1); ARG_UNUSED(p2); ARG_UNUSED(p3);

    printk("[BTN] Thread démarré (sw0)\n");

    int last_state = gpio_pin_get_dt(&button);

    while (1) {
        int state = gpio_pin_get_dt(&button);

        if (state == 0 && last_state == 1) {
            /* Front montant détecté → appui bouton */
            printk("[BTN] Appui détecté → envoi CONFIRM vers RPi\n");
            rpi_send("CONFIRM\r\n");
        }

        last_state = state;
        k_msleep(50); /* anti-rebond */
    }
}

/* ════════════════════════════════════════════════════════════════════════
 *  main
 * ════════════════════════════════════════════════════════════════════════ */

int main(void)
{
    serializer = DEVICE_DT_GET(SERIALIZER_DEV);
    rpi_uart   = DEVICE_DT_GET(RPI_UART_DEV);
    gpioa      = DEVICE_DT_GET(GPIOA_NODE);
    accel_dev  = DEVICE_DT_GET(ACCEL_NODE);

    /* Vérification des périphériques */
    if (!device_is_ready(serializer)) {
        printk("[INIT] ERREUR : serializer (uart4) non prêt\n"); return 0;
    }
    if (!device_is_ready(rpi_uart)) {
        printk("[INIT] ERREUR : rpi_uart (uart5) non prêt\n");   return 0;
    }
    if (!device_is_ready(gpioa)) {
        printk("[INIT] ERREUR : gpioa non prêt\n");               return 0;
    }
    if (!device_is_ready(accel_dev)) {
        printk("[INIT] ERREUR : ADXL345 non prêt\n");             return 0;
    }
    if (!gpio_is_ready_dt(&button)) {
        printk("[INIT] ERREUR : bouton (sw0) non prêt\n");        return 0;
    }

    /* Config GPIO */
    gpio_pin_configure(gpioa, 8, GPIO_OUTPUT_INACTIVE); /* sonar TRIG */
    gpio_pin_configure(gpioa, 9, GPIO_INPUT);           /* sonar ECHO */
    gpio_pin_configure_dt(&button, GPIO_INPUT);

    printk("[INIT] Tous les périphériques OK\n");

    /* Lancement des threads */
    k_tid_t accel_tid = k_thread_create(
        &accel_thread_data, accel_stack_area,
        K_THREAD_STACK_SIZEOF(accel_stack_area),
        accel_thread_main, NULL, NULL, NULL,
        ACCEL_PRIORITY, 0, K_NO_WAIT);
    k_thread_name_set(accel_tid, "accel_monitor");
    printk("[INIT] Thread accel_monitor lancé\n");

    k_tid_t sonar_tid = k_thread_create(
        &sonar_thread_data, sonar_stack_area,
        K_THREAD_STACK_SIZEOF(sonar_stack_area),
        sonar_thread_main, NULL, NULL, NULL,
        SONAR_PRIORITY, 0, K_NO_WAIT);
    k_thread_name_set(sonar_tid, "sonar_measure");
    printk("[INIT] Thread sonar_measure lancé\n");

    k_tid_t button_tid = k_thread_create(
        &button_thread_data, button_stack_area,
        K_THREAD_STACK_SIZEOF(button_stack_area),
        button_thread_main, NULL, NULL, NULL,
        BUTTON_PRIORITY, 0, K_NO_WAIT);
    k_thread_name_set(button_tid, "button_monitor");
    printk("[INIT] Thread button_monitor lancé\n");

    k_sleep(K_MSEC(1000));

    /* ── Boucle principale : écoute RPi ─────────────────────────────── */
    char rx_buf[RX_BUF_SIZE];
    unsigned char first_char;

    printk("[MAIN] Système prêt. Écoute RPi active (uart5)...\n");

    while (1) {
        uint32_t dist = (uint32_t)atomic_get(&shared_distance_cm);

        /* Sécurité obstacle */
        if (dist > 0 && dist < 20 && atomic_get(&is_moving_forward)) {
            safe_stop();
            printk("[MAIN] OBSTACLE (%u cm) : ARRÊT SÉCURITÉ\n", dist);
        }

        /* Réception commande RPi */
        if (uart_poll_in(rpi_uart, &first_char) == 0) {
            if (first_char == '\n' || first_char == '\r') continue;
            
            printk("[RX] Premier octet : 0x%02X '%c'\n",
                   first_char, (first_char >= 0x20 && first_char < 0x7F) ? first_char : '?');

            int len = uart_read_line(rpi_uart, (int)first_char,
                                     rx_buf, sizeof(rx_buf),
                                     UART_READ_TIMEOUT_MS);
            if (len > 0) {
                printk("[RX] Commande RPi : '%s' (%d octets)\n", rx_buf, len);

                if (strncmp(rx_buf, "FWD", 3) == 0 && dist > 0 && dist < 20) {
                    printk("[RX] FWD refusé : obstacle à %u cm\n", dist);
                    safe_stop();
                } else {
                    process(serializer, rx_buf);
                }
            } else {
                printk("[RX] Timeout ou trame vide, flush buffer\n");
                unsigned char flush;
                while (uart_poll_in(rpi_uart, &flush) == 0) { /* vide */ }
            }
        }

        k_msleep(10);
    }

    return 0;
}