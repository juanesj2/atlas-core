#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <driver/i2s.h>

// --- CONFIGURACIÓN WIFI ---
const char* ssid = "TU_WIFI_SSID";
const char* password = "TU_WIFI_PASSWORD";

// --- CONFIGURACIÓN SERVIDOR ATLAS ---
const char* websocket_server = "192.168.1.100"; // Cambiar por la IP de tu torre
const int websocket_port = 8080;

WebSocketsClient webSocket;

// --- CONFIGURACIÓN I2S (Micrófono INMP441) ---
#define I2S_WS 15
#define I2S_SD 13
#define I2S_SCK 2
#define I2S_PORT I2S_NUM_0
#define SAMPLE_RATE 16000
#define DMA_BUF_LEN 512
#define DMA_NUM_BUF 8

bool isRecording = false;

void setupI2S() {
    i2s_config_t i2s_config = {
        .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
        .sample_rate = SAMPLE_RATE,
        .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
        .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
        .communication_format = i2s_comm_format_t(I2S_COMM_FORMAT_I2S | I2S_COMM_FORMAT_I2S_MSB),
        .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
        .dma_buf_count = DMA_NUM_BUF,
        .dma_buf_len = DMA_BUF_LEN,
        .use_apll = false,
        .tx_desc_auto_clear = false,
        .fixed_mclk = 0
    };

    i2s_pin_config_t pin_config = {
        .bck_io_num = I2S_SCK,
        .ws_io_num = I2S_WS,
        .data_out_num = I2S_PIN_NO_CHANGE,
        .data_in_num = I2S_SD
    };

    i2s_driver_install(I2S_PORT, &i2s_config, 0, NULL);
    i2s_set_pin(I2S_PORT, &pin_config);
    i2s_zero_dma_buffer(I2S_PORT);
}

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
    switch(type) {
        case WStype_DISCONNECTED:
            Serial.println("[WS] Desconectado");
            break;
        case WStype_CONNECTED:
            Serial.println("[WS] Conectado al servidor ATLAS");
            // Aquí podríamos enviar un JSON diciendo "Soy el satélite del salón"
            break;
        case WStype_TEXT:
            Serial.printf("[WS] Texto recibido: %s\n", payload);
            // El servidor envía comandos JSON para cambiar las luces LED de estado (THINKING, IDLE...)
            break;
        case WStype_BIN:
            // Si el servidor nos manda audio TTS de vuelta, lo reproducimos por otro I2S o DAC
            Serial.printf("[WS] Recibido %u bytes de audio binario\n", length);
            break;
    }
}

void setup() {
    Serial.begin(115200);

    // 1. Conectar WiFi
    WiFi.begin(ssid, password);
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }
    Serial.println("\n[WiFi] Conectado");

    // 2. Configurar I2S
    setupI2S();

    // 3. Conectar a Atlas
    webSocket.begin(websocket_server, websocket_port, "/");
    webSocket.onEvent(webSocketEvent);
    webSocket.setReconnectInterval(5000);
}

void loop() {
    webSocket.loop();

    // TODO: Detectar la "Wake Word" (Ej: "Atlas"). 
    // Por simplicidad, simularemos que cuando isRecording es true, manda datos.
    // Esto lo engancharemos a un botón físico o a una librería de Wake Word ligera.
    
    // if (boton_pulsado) { isRecording = true; }

    if (isRecording && webSocket.isConnected()) {
        size_t bytesIn = 0;
        int16_t sampleBuffer[DMA_BUF_LEN];
        
        esp_err_t result = i2s_read(I2S_PORT, &sampleBuffer, sizeof(sampleBuffer), &bytesIn, portMAX_DELAY);
        if (result == ESP_OK && bytesIn > 0) {
            // Mandamos el audio binario directamente a la torre
            webSocket.sendBIN((uint8_t*)sampleBuffer, bytesIn);
        }
    }
}
