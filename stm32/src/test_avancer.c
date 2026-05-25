#include <zephyr/kernel.h>
#include <zephyr/device.h>
#include <zephyr/drivers/uart.h>
#include <zephyr/devicetree.h>
#include <string.h>

#define SERIALIZER_DEV DT_NODELABEL(uart4)

int main(void)
{
    const struct device *serializer = DEVICE_DT_GET(SERIALIZER_DEV);

    if (!device_is_ready(serializer)) {
        printk("[ERREUR] serializer non prêt\n");
        return 0;
    }

    printk("[OK] Serializer prêt, envoi commande moteurs...\n");

    const char *cmd = "mogo 1:50 2:50;\r";
    for (int i = 0; cmd[i] != '\0'; i++) {
        uart_poll_out(serializer, cmd[i]);
    }

    printk("[OK] Commande envoyée : %s\n", cmd);

    while (1) {
        k_msleep(1000);
    }

    return 0;
}
