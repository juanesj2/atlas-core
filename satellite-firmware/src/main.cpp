#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <TFT_eSPI.h>
#include <driver/i2s.h>
#include "AtlasHUD.h"

// --- CONFIGURACIÓN WIFI ---
const char* ssid = "TU_WIFI_SSID";
const char* password = "TU_WIFI_PASSWORD";

// --- CONFIGURACIÓN SERVIDOR ATLAS ---
const char* websocket_server = "192.168.1.100"; // Cambiar por la IP de tu PC / Servidor
const int websocket_port = 8080;

WebSocketsClient webSocket;
TFT_eSPI tft = TFT_eSPI();
AtlasHUDEngine hud(&tft);

// --- CONFIGURACIÓN I2S (Micrófono INMP441) ---
#define I2S_WS 15
#define I2S_SD 13
#define I2S_SCK 2
#define I2S_PORT I2S_NUM_0
#define SAMPLE_RATE 16000
#define DMA_BUF_LEN 512
#define DMA_NUM_BUF 8

bool isRecording = false;
unsigned long recordingEndTime = 0;

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
            Serial.println("[WS] Desconectado de Atlas Gateway");
            hud.updateState(STATE_IDLE);
            break;
        case WStype_CONNECTED:
            Serial.println("[WS] Conectado exitosamente al servidor ATLAS");
            hud.updateState(STATE_IDLE);
            break;
        case WStype_TEXT: {
            String msg = (char*)payload;
            Serial.printf("[WS] Mensaje: %s\n", msg.c_str());
            StaticJsonDocument<256> doc;
            DeserializationError err = deserializeJson(doc, msg);
            if (!err) {
                if (doc.containsKey("state")) {
                    String state = doc["state"];
                    hud.updateStateFromString(state);
                }
            }
            if (msg.indexOf("OPEN_MIC") >= 0) {
                Serial.println("[WS] 🎤 Conversación Continua: Activando escucha...");
                isRecording = true;
                recordingEndTime = millis() + 8000;
                hud.updateState(STATE_LISTENING);
            }
            break;
        }
        case WStype_BIN:
            // Buffer de audio TTS recibido
            break;
    }
}

bool isDemoMode = false;
unsigned long lastDemoSwitch = 0;
int demoStep = 0;

void setup() {
    Serial.begin(115200);

    // 1. Inicializar HUD en Pantalla Circular GC9A01
    hud.begin();

    // 2. Conectar WiFi (con timeout para permitir pruebas en simulador sin red)
    Serial.print("Conectando a WiFi...");
    WiFi.begin(ssid, password);
    unsigned long wifiStart = millis();
    bool wifiConnected = false;
    
    while (millis() - wifiStart < 3500) { // 3.5 segundos de margen
        if (WiFi.status() == WL_CONNECTED) {
            wifiConnected = true;
            break;
        }
        delay(250);
        Serial.print(".");
    }

    if (wifiConnected) {
        Serial.println("\n[WiFi] Conectado! Modo Satelite Online.");
        setupI2S();
        webSocket.begin(websocket_server, websocket_port, "/");
        webSocket.onEvent(webSocketEvent);
        webSocket.setReconnectInterval(5000);
    } else {
        Serial.println("\n[WiFi] Sin conexion WiFi detectada.");
        Serial.println("[ATLAS] 🚀 Activando MODO DEMOSTRACION / TEST (Ciclo automatico de estados).");
        isDemoMode = true;
    }
}

// --- UMBRALES DE VOZ ---
#define VAD_THRESHOLD 2500
#define RECORD_TIME_MS 5000

void loop() {
    // Actualizar animación suave del reactor cuántico a ~30 FPS sin parpadeo
    hud.updateAnimation();

    if (isDemoMode) {
        // En modo demostración (para pruebas y simulador Wokwi):
        // Alterna entre REPOSO, ESCUCHANDO, PENSANDO y HABLANDO cada 4 segundos
        unsigned long now = millis();
        if (now - lastDemoSwitch > 4000) {
            lastDemoSwitch = now;
            demoStep = (demoStep + 1) % 4;
            switch(demoStep) {
                case 0: hud.updateState(STATE_IDLE); break;
                case 1: hud.updateState(STATE_LISTENING); break;
                case 2: hud.updateState(STATE_THINKING); break;
                case 3: hud.updateState(STATE_SPEAKING); break;
            }
        }
        delay(5);
        return;
    }

    webSocket.loop();

    size_t bytesIn = 0;
    int16_t sampleBuffer[DMA_BUF_LEN];
    
    esp_err_t result = i2s_read(I2S_PORT, &sampleBuffer, sizeof(sampleBuffer), &bytesIn, 0);
    
    if (result == ESP_OK && bytesIn > 0) {
        if (!isRecording) {
            int64_t energy = 0;
            for (int i = 0; i < bytesIn / 2; i++) {
                energy += abs(sampleBuffer[i]);
            }
            int32_t avgEnergy = energy / (bytesIn / 2);

            if (avgEnergy > VAD_THRESHOLD) {
                Serial.printf("[VAD] 🚨 Voz detectada (Energía: %d). Grabando...\n", avgEnergy);
                isRecording = true;
                recordingEndTime = millis() + RECORD_TIME_MS;
                hud.updateState(STATE_LISTENING);
                webSocket.sendTXT("{\"event\": \"WAKE_WORD_DETECTED\"}");
            }
        }
        
        if (isRecording) {
            if (webSocket.isConnected()) {
                webSocket.sendBIN((uint8_t*)sampleBuffer, bytesIn);
            }
            
            if (millis() > recordingEndTime) {
                Serial.println("[VAD] 🛑 Grabación finalizada.");
                isRecording = false;
                hud.updateState(STATE_THINKING);
            }
        }
    }
}
