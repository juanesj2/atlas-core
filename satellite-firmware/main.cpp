#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <TFT_eSPI.h> // Librería gráfica para la pantalla GC9A01

// ================= Configuración =================
const char* ssid = "TU_WIFI";
const char* password = "TU_PASSWORD";
const char* ws_host = "192.168.1.140"; // IP del Servidor Local (Ubuntu Tower)
const uint16_t ws_port = 8080;

WebSocketsClient webSocket;
TFT_eSPI tft = TFT_eSPI();

void drawEyeState(String state, String animation) {
    tft.fillScreen(TFT_BLACK);
    
    if (state == "IDLE") {
        // Ojo cerrado o durmiendo
        tft.fillCircle(120, 120, 10, TFT_DARKGREY);
    } 
    else if (state == "LISTENING") {
        // Escuchando (Anillo verde)
        tft.drawCircle(120, 120, 100, TFT_GREEN);
        tft.fillCircle(120, 120, 30, TFT_GREEN);
    } 
    else if (state == "THINKING") {
        // Pensando (Anillo azul parpadeante - simplificado para C++)
        tft.drawCircle(120, 120, 100, TFT_BLUE);
        tft.drawCircle(120, 120, 99, TFT_BLUE);
    } 
    else if (state == "SPEAKING") {
        // Hablando (Forma de onda rosa/roja - simplificado)
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
        }
    }
}

void setup() {
    Serial.begin(115200);

    // Inicializar Pantalla
    tft.begin();
    tft.setRotation(0);
    tft.fillScreen(TFT_BLACK);
    
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
    
    // Aquí iría el código I2S para enviar el audio del micrófono MAX9814/INMP441
    // y recibir el audio de PiperTTS hacia el MAX98357A.
}
