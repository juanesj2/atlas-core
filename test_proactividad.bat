@echo off
echo ==============================================
echo ⚡ TEST DE PROACTIVIDAD DE ATLAS
echo ==============================================
echo.
echo Simulando que un sensor de movimiento de Home Assistant ha detectado que entraste al salon...
echo.

curl -X POST http://localhost:8080/api/trigger ^
-H "Content-Type: application/json" ^
-d "{\"event\":\"movimiento_salon_mañana\", \"context\":\"Son las 8:00 AM, temperatura 18 grados\", \"username\":\"Juanes\"}"

echo.
echo.
echo Si Atlas esta corriendo, deberia haber hablado por los altavoces de la casa.
pause
