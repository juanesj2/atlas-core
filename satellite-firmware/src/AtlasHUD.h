#ifndef ATLAS_HUD_H
#define ATLAS_HUD_H

#include <Arduino.h>
#include <SPI.h>
#include <TFT_eSPI.h>

#ifndef PI
#define PI 3.14159265358979323846
#endif

#ifndef DEG_TO_RAD
#define DEG_TO_RAD 0.01745329251994329576
#endif

#define HUD_SIZE 240
#define CX 120
#define CY 120

#define RGB565(r, g, b) (((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3))

#define HUD_COLOR_CYAN         RGB565(0, 229, 255)
#define HUD_COLOR_BRIGHT_CYAN  RGB565(0, 255, 255)
#define HUD_COLOR_MID_BLUE     RGB565(0, 140, 200)
#define HUD_COLOR_DEEP_BLUE    RGB565(0, 60, 110)
#define HUD_COLOR_BLACK        0x0000
#define HUD_COLOR_WHITE        0xFFFF

#define STATE_COLOR_IDLE       RGB565(0, 229, 255)
#define STATE_COLOR_LISTENING  RGB565(0, 255, 136)
#define STATE_COLOR_THINKING   RGB565(255, 0, 234)
#define STATE_COLOR_SPEAKING   RGB565(255, 255, 255)

enum AtlasState {
    STATE_IDLE,
    STATE_LISTENING,
    STATE_THINKING,
    STATE_SPEAKING
};

class AtlasHUDEngine {
private:
    TFT_eSPI* tft;
    TFT_eSprite* coreSprite;
    AtlasState currentState;
    uint16_t stateColor;
    
    float rotAngle1;
    float rotAngle2;
    unsigned long lastAnimTime;
    float pulseVal;
    int pulseDir;

public:
    AtlasHUDEngine(TFT_eSPI* display) {
        tft = display;
        coreSprite = new TFT_eSprite(display);
        currentState = STATE_IDLE;
        stateColor = STATE_COLOR_IDLE;
        rotAngle1 = 0;
        rotAngle2 = 0;
        lastAnimTime = 0;
        pulseVal = 4.0;
        pulseDir = 1;
    }

    void begin() {
        tft->init();
        tft->setRotation(0);
        tft->fillScreen(HUD_COLOR_BLACK);

        coreSprite->setColorDepth(16);
        coreSprite->createSprite(72, 72);

        drawStaticHUD();
        updateState(STATE_IDLE);
    }

    void updateState(AtlasState newState) {
        currentState = newState;
        switch (currentState) {
            case STATE_LISTENING: stateColor = STATE_COLOR_LISTENING; break;
            case STATE_THINKING:  stateColor = STATE_COLOR_THINKING; break;
            case STATE_SPEAKING:  stateColor = STATE_COLOR_SPEAKING; break;
            default:              stateColor = STATE_COLOR_IDLE; break;
        }
        drawReactiveHUD();
    }

    void updateStateFromString(String stateStr) {
        stateStr.toUpperCase();
        if (stateStr == "LISTENING") updateState(STATE_LISTENING);
        else if (stateStr == "THINKING") updateState(STATE_THINKING);
        else if (stateStr == "SPEAKING") updateState(STATE_SPEAKING);
        else updateState(STATE_IDLE);
    }

    void drawThickArc(int cx, int cy, int r, int startAngle, int endAngle, uint16_t color, int thickness) {
        for (int t = 0; t < thickness; t++) {
            int curR = r + t;
            for (int a = startAngle; a <= endAngle; a++) {
                float rad = a * DEG_TO_RAD;
                int x = cx + curR * cos(rad);
                int y = cy + curR * sin(rad);
                tft->drawPixel(x, y, color);
            }
        }
    }

    void drawCurvedText(const char* text, int r, float startDeg, float endDeg, uint16_t color) {
        int len = strlen(text);
        if (len <= 1) return;
        float step = (endDeg - startDeg) / (float)(len - 1);
        tft->setTextColor(color, HUD_COLOR_BLACK);
        tft->setTextDatum(MC_DATUM);
        for (int i = 0; i < len; i++) {
            if (text[i] == ' ') continue;
            float deg = startDeg + i * step;
            float rad = deg * DEG_TO_RAD;
            int x = CX + r * cos(rad);
            int y = CY + r * sin(rad);
            char ch[2] = { text[i], '\0' };
            tft->drawString(ch, x, y, 1);
        }
    }

    void drawChevrons(uint16_t color) {
        tft->drawLine(50, 115, 45, 120, color);
        tft->drawLine(51, 115, 46, 120, color);
        tft->drawLine(45, 120, 50, 125, color);
        tft->drawLine(46, 120, 51, 125, color);

        tft->drawLine(190, 115, 195, 120, color);
        tft->drawLine(189, 115, 194, 120, color);
        tft->drawLine(195, 120, 190, 125, color);
        tft->drawLine(194, 120, 189, 125, color);
    }

    void drawStaticHUD() {
        tft->fillScreen(HUD_COLOR_BLACK);

        for (int a = 0; a < 360; a += 5) {
            float rad = a * DEG_TO_RAD;
            int r1 = (a % 15 == 0) ? 110 : 114;
            tft->drawLine(CX + r1 * cos(rad), CY + r1 * sin(rad), CX + 118 * cos(rad), CY + 118 * sin(rad), (a % 15 == 0) ? HUD_COLOR_CYAN : HUD_COLOR_DEEP_BLUE);
        }

        tft->drawCircle(CX, CY, 109, HUD_COLOR_DEEP_BLUE);
        tft->drawCircle(CX, CY, 118, HUD_COLOR_CYAN);

        tft->drawFastHLine(18, CY, 15, HUD_COLOR_CYAN);
        tft->drawFastHLine(18, CY + 1, 15, HUD_COLOR_CYAN);
        tft->drawFastHLine(207, CY, 15, HUD_COLOR_CYAN);
        tft->drawFastHLine(207, CY + 1, 15, HUD_COLOR_CYAN);
        tft->drawFastVLine(CX, 18, 15, HUD_COLOR_CYAN);
        tft->drawFastVLine(CX + 1, 18, 15, HUD_COLOR_CYAN);
        tft->drawFastVLine(CX, 207, 15, HUD_COLOR_CYAN);
        tft->drawFastVLine(CX + 1, 207, 15, HUD_COLOR_CYAN);

        tft->drawCircle(CX, CY, 98, HUD_COLOR_DEEP_BLUE);

        tft->setTextDatum(TC_DATUM);
        tft->setTextColor(HUD_COLOR_WHITE, HUD_COLOR_BLACK);
        tft->drawString("ATLAS", CX, 24, 4);

        tft->setTextColor(HUD_COLOR_CYAN, HUD_COLOR_BLACK);
        tft->drawString("VOZ ACTIVA", CX, 48, 1);

        for (int i = 0; i < 6; i++) {
            float radL = (100 + i * 9) * DEG_TO_RAD;
            int x1L = CX - 68 * cos(radL * 0.48);
            int y1L = CY - 68 * sin(radL * 0.48) + 32;
            tft->drawLine(x1L, y1L, x1L - 11, y1L - 9, HUD_COLOR_CYAN);
            tft->drawLine(x1L, y1L + 1, x1L - 11, y1L - 8, HUD_COLOR_CYAN);

            float radR = (100 + i * 9) * DEG_TO_RAD;
            int x1R = CX + 68 * cos(radR * 0.48);
            int y1R = CY - 68 * sin(radR * 0.48) + 32;
            tft->drawLine(x1R, y1R, x1R + 11, y1R - 9, HUD_COLOR_CYAN);
            tft->drawLine(x1R, y1R + 1, x1R + 11, y1R - 8, HUD_COLOR_CYAN);
        }

        for (int a = 18; a < 342; a += 18) {
            float rad = a * DEG_TO_RAD;
            tft->drawLine(CX + 45 * cos(rad), CY + 45 * sin(rad), CX + 53 * cos(rad), CY + 53 * sin(rad), HUD_COLOR_MID_BLUE);
            tft->drawLine(CX + 45 * cos(rad + 0.04), CY + 45 * sin(rad + 0.04), CX + 53 * cos(rad + 0.04), CY + 53 * sin(rad + 0.04), HUD_COLOR_MID_BLUE);
        }
        tft->drawCircle(CX, CY, 44, HUD_COLOR_DEEP_BLUE);
        tft->drawCircle(CX, CY, 54, HUD_COLOR_DEEP_BLUE);

        tft->drawCircle(CX, 153, 7, HUD_COLOR_CYAN);
        tft->drawRoundRect(CX - 2, 149, 5, 7, 2, HUD_COLOR_CYAN);
        tft->drawFastVLine(CX, 156, 3, HUD_COLOR_CYAN);
        tft->drawFastHLine(CX - 3, 159, 7, HUD_COLOR_CYAN);

        drawCurvedText("SISTEMA ATLAS IA v2.1 // LISTO", 103, 148, 32, HUD_COLOR_CYAN);
    }

    void drawReactiveHUD() {
        uint16_t arcColor = (currentState == STATE_IDLE) ? HUD_COLOR_BLACK : stateColor;
        drawThickArc(CX, CY, 87, 0, 180, arcColor, 2);
        drawThickArc(CX, CY, 71, 5, 175, arcColor, 2);
        drawChevrons((currentState == STATE_IDLE) ? HUD_COLOR_CYAN : stateColor);

        drawThickArc(CX, CY, 81, 20, 160, HUD_COLOR_BLACK, 6);
        const char* labels[] = { "ESTADO: REPOSO", "ESTADO: ESCUCHANDO", "ESTADO: PENSANDO", "ESTADO: HABLANDO" };
        drawCurvedText(labels[currentState], 82, 142, 38, stateColor);
    }

    void updateAnimation() {
        unsigned long now = millis();
        if (now - lastAnimTime < 33) return;
        lastAnimTime = now;

        float speed = (currentState == STATE_THINKING) ? 0.08 : 0.03;
        rotAngle1 += speed;
        rotAngle2 -= speed * 0.7;

        pulseVal += 0.25 * pulseDir;
        if (pulseVal > 5.5) { pulseVal = 5.5; pulseDir = -1; }
        if (pulseVal < 2.5) { pulseVal = 2.5; pulseDir = 1; }

        renderReactorCore();
    }

private:
    void renderReactorCore() {
        int scx = 36, scy = 36;
        coreSprite->fillSprite(HUD_COLOR_BLACK);

        uint16_t auraColor = (currentState == STATE_LISTENING) ? RGB565(0, 50, 25) : 
                             (currentState == STATE_THINKING)  ? RGB565(45, 0, 45) : 
                             (currentState == STATE_SPEAKING)  ? RGB565(30, 70, 90) : RGB565(0, 30, 50);

        uint16_t coreGlow =  (currentState == STATE_LISTENING) ? RGB565(0, 100, 50) : 
                             (currentState == STATE_THINKING)  ? RGB565(90, 0, 90) : 
                             (currentState == STATE_SPEAKING)  ? RGB565(60, 140, 180) : RGB565(0, 60, 100);

        coreSprite->fillCircle(scx, scy, 35, auraColor);
        coreSprite->fillCircle(scx, scy, 27, coreGlow);
        coreSprite->drawCircle(scx, scy, 35, HUD_COLOR_DEEP_BLUE);
        coreSprite->drawCircle(scx, scy, 25, stateColor);

        drawRotatedTriangle(scx, scy, 30, rotAngle1, stateColor);
        drawRotatedTriangle(scx, scy, 30, rotAngle1 + PI, stateColor);
        drawRotatedTriangle(scx, scy, 21, rotAngle2 + 0.785, HUD_COLOR_BRIGHT_CYAN);
        drawRotatedTriangle(scx, scy, 21, rotAngle2 + 3.927, HUD_COLOR_BRIGHT_CYAN);

        coreSprite->drawCircle(scx, scy, 14, HUD_COLOR_WHITE);
        for (int i = 0; i < 6; i++) {
            float ang = rotAngle1 + (i * PI / 3.0);
            coreSprite->fillCircle(scx + 30 * cos(ang), scy + 30 * sin(ang), 2, HUD_COLOR_WHITE);
        }

        coreSprite->fillCircle(scx, scy, (int)pulseVal + 2, HUD_COLOR_BRIGHT_CYAN);
        coreSprite->fillCircle(scx, scy, (int)pulseVal, HUD_COLOR_WHITE);

        coreSprite->pushSprite(84, 84);
    }

    void drawRotatedTriangle(int cx, int cy, int r, float angle, uint16_t color) {
        int x0 = cx + r * cos(angle);
        int y0 = cy + r * sin(angle);
        int x1 = cx + r * cos(angle + 2.0944);
        int y1 = cy + r * sin(angle + 2.0944);
        int x2 = cx + r * cos(angle + 4.1888);
        int y2 = cy + r * sin(angle + 4.1888);
        coreSprite->drawLine(x0, y0, x1, y1, color);
        coreSprite->drawLine(x1, y1, x2, y2, color);
        coreSprite->drawLine(x2, y2, x0, y0, color);
    }
};

#endif // ATLAS_HUD_H
