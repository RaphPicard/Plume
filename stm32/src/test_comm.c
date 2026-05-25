#include <zephyr/kernel.h>
#include <zephyr/device.h>
#include <zephyr/drivers/uart.h>
#include <zephyr/devicetree.h>
#include <string.h>

#define RPI_UART_DEV DT_NODELABEL(uart5)
#define RX_BUF_SIZE  64

static const struct device *rpi_uart;

/* Ring buffer simple pour la réception */
static char rx_buf[RX_BUF_SIZE];
static volatile int rx_head = 0;
static volatile int rx_tail = 0;

/* Callback UART appelé par interruption */
static void uart_cb(const struct device *dev, void *user_data)
{
    if (!uart_irq_update(dev)) return;

    while (uart_irq_rx_ready(dev)) {
        unsigned char c;
        int ret = uart_fifo_read(dev, &c, 1);
        if (ret <= 0) break;

        int next = (rx_head + 1) % RX_BUF_SIZE;
        if (next != rx_tail) {
            rx_buf[rx_head] = c;
            rx_head = next;
        }
        /* si buffer plein, on ignore l'octet */
    }
}

/* Lit un octet depuis le ring buffer, retourne -1 si vide */
static int rb_read(unsigned char *out)
{
    if (rx_tail == rx_head) return -1;
    *out = rx_buf[rx_tail];
    rx_tail = (rx_tail + 1) % RX_BUF_SIZE;
    return 0;
}

/* Envoie une string sur uart5 */
static void uart_send(const char *s)
{
    while (*s) {
        uart_poll_out(rpi_uart, *s++);
    }
}

int main(void)
{
    rpi_uart = DEVICE_DT_GET(RPI_UART_DEV);

    printk("\n");
    printk("╔══════════════════════════════════════════╗\n");
    printk("║   TEST COMMUNICATION UART5 (RPi→STM32)  ║\n");
    printk("║   Baudrate : 115200                      ║\n");
    printk("║   Pins     : TX=PC12  RX=PD2             ║\n");
    printk("╚══════════════════════════════════════════╝\n\n");

    if (!device_is_ready(rpi_uart)) {
        printk("[ERREUR] uart5 non pret !\n");
        return 0;
    }

    /* Enregistre le callback d'interruption */
    uart_irq_callback_set(rpi_uart, uart_cb);
    uart_irq_rx_enable(rpi_uart);

    printk("[OK] uart5 pret (interrupt driven).\n");
    printk("     En attente de donnees depuis la Raspberry Pi...\n\n");

    char line_buf[64];
    int  line_idx   = 0;
    uint32_t byte_count = 0;

    while (1) {
        unsigned char c;
        if (rb_read(&c) == 0) {
            byte_count++;

            if (c >= 0x20 && c < 0x7F) {
                printk("[RX #%u] HEX=0x%02X  ASCII='%c'\n", byte_count, c, c);
            } else {
                const char *name;
                switch (c) {
                    case '\r':  name = "<CR  \\r>"; break;
                    case '\n':  name = "<LF  \\n>"; break;
                    case 0x00:  name = "<NUL>    "; break;
                    case 0x7F:  name = "<DEL>    "; break;
                    default:    name = "<CTRL>   "; break;
                }
                printk("[RX #%u] HEX=0x%02X  %s\n", byte_count, c, name);
            }

            if (c == '\r' || c == '\n') {
                if (line_idx > 0) {
                    line_buf[line_idx] = '\0';

                    printk("\n");
                    printk("┌─────────────────────────────────────┐\n");
                    printk("│ LIGNE COMPLETE : %-19s │\n", line_buf);
                    printk("│ Longueur       : %-2d octets           │\n", line_idx);
                    printk("└─────────────────────────────────────┘\n\n");

                    uart_send("ACK\r\n");
                    printk("[TX] ACK envoye vers RPi.\n\n");

                    line_idx = 0;
                }
            } else if (line_idx < (int)sizeof(line_buf) - 1) {
                line_buf[line_idx++] = (char)c;
            }
        }

        k_yield();
    }

    return 0;
}