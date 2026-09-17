#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <TFT_eSPI.h> // Librería gráfica para la pantalla GC9A01
#include <driver/i2s.h>

// ================= Configuración =================
const char* ssid = "TU_WIFI";
const char* password = "TU_PASSWORD";
const char* ws_host = "192.168.1.140"; // IP del Servidor Local (Ubuntu Tower)
const uint16_t ws_port = 8080;

WebSocketsClient webSocket;
TFT_eSPI tft = TFT_eSPI();

// Pines I2S Micrófono (INMP441)
#define I2S_MIC_WS 15
#define I2S_MIC_SD 13
#define I2S_MIC_SCK 2

// Pines I2S Altavoz (MAX98357A)
#define I2S_SPK_BCLK 27
#define I2S_SPK_LRC 26
#define I2S_SPK_DIN 25

bool isSpeaking = false;

void initI2S() {
    // Configuración compartida I2S
    i2s_config_t i2s_config = {
        .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX | I2S_MODE_TX),
        .sample_rate = 16000,
        .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
        .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
        .communication_format = I2S_COMM_FORMAT_STAND_I2S,
        .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
        .dma_buf_count = 8,
        .dma_buf_len = 1024,
        .use_apll = false,
        .tx_desc_auto_clear = true,
        .fixed_mclk = 0
    };

    // Pines para recepción y transmisión simultánea en I2S Port 0
    i2s_pin_config_t pin_config = {
        .bck_io_num = I2S_SPK_BCLK,   // Reloj compartido
        .ws_io_num = I2S_SPK_LRC,     // WS compartido
        .data_out_num = I2S_SPK_DIN,  // Salida a MAX98357A
        .data_in_num = I2S_MIC_SD     // Entrada de INMP441
    };

    i2s_driver_install(I2S_NUM_0, &i2s_config, 0, NULL);
    i2s_set_pin(I2S_NUM_0, &pin_config);
}

void drawEyeState(String state, String animation) {
    tft.fillScreen(TFT_BLACK);
    
    if (state == "IDLE") {
        tft.fillCircle(120, 120, 10, TFT_DARKGREY);
    } 
    else if (state == "LISTENING") {
        tft.drawCircle(120, 120, 100, TFT_GREEN);
        tft.fillCircle(120, 120, 30, TFT_GREEN);
    } 
    else if (state == "THINKING") {
        tft.drawCircle(120, 120, 100, TFT_BLUE);
        tft.drawCircle(120, 120, 99, TFT_BLUE);
    } 
    else if (state == "SPEAKING") {
        tft.drawCircle(120, 120, 100, TFT_RED);
        tft.fillRect(90, 80, 60, 80, TFT_RED);
    }
}

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
    if (type == WStype_TEXT) {
        String msg = (char*)payload;
        StaticJsonDocument<256> doc;
        deserializeJson(doc, msg);
        
        if (doc.containsKey("state")) {
            String state = doc["state"];
            String animation = doc["animation"];
            Serial.printf("Cambio de Estado: %s\n", state.c_str());
            drawEyeState(state, animation);

            if (state == "SPEAKING") isSpeaking = true;
            else isSpeaking = false;
        }
    } else if (type == WStype_BIN) {
        // Recibir buffer de audio del servidor y enviarlo al DAC MAX98357A
        size_t bytes_written;
        i2s_write(I2S_NUM_0, payload, length, &bytes_written, portMAX_DELAY);
    }
}

void setup() {
    Serial.begin(115200);

    // Inicializar Pantalla
    tft.begin();
    tft.setRotation(0);
    tft.fillScreen(TFT_BLACK);
    
    // Inicializar Audio
    initI2S();

    // Conectar a Wi-Fi
    Serial.print("Conectando a WiFi...");
    WiFi.begin(ssid, password);
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }
    Serial.println(" Conectado!");
    
    // Configurar WebSocket
    webSocket.begin(ws_host, ws_port, "/");
    webSocket.onEvent(webSocketEvent);
    webSocket.setReconnectInterval(5000);
    
    drawEyeState("IDLE", "sleeping");
}

void loop() {
    webSocket.loop();
    
    // Transmisión de Audio: Leer micrófono INMP441 y enviarlo si no está hablando
    if (!isSpeaking && webSocket.isConnected()) {
        size_t bytes_read;
        uint8_t i2s_read_buff[1024];
        i2s_read(I2S_NUM_0, (void*)i2s_read_buff, sizeof(i2s_read_buff), &bytes_read, portMAX_DELAY);
        
        if (bytes_read > 0) {
            webSocket.sendBIN(i2s_read_buff, bytes_read);
        }
    }
}

