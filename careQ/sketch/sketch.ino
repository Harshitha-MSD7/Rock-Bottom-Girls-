#include <Arduino_RouterBridge.h>

bool alert_enabled = false;
bool buzzer_on = false;
unsigned long next_alert_change = 0;

// Drive the active buzzer connected to Arduino digital pin 9.
void beep() {
  digitalWrite(9, HIGH);
  delay(300);
  digitalWrite(9, LOW);
}

void set_alert(bool enabled) {
  alert_enabled = enabled;

  if (!enabled) {
    buzzer_on = false;
    digitalWrite(9, LOW);
    Serial.println("alert disabled");
    return;
  }

  next_alert_change = 0;
  Serial.println("alert enabled");
}

void setup() {
  // Initialize serial logging, the buzzer pin, and Python-to-MCU RPC handlers.
  Serial.begin(115200);
  pinMode(9, OUTPUT);
  digitalWrite(9, LOW);

  Bridge.begin();
  Bridge.provide("beep", beep);
  Bridge.provide("set_alert", set_alert);
  Serial.println("MCU ready: beep on pin 9");
}

void loop() {
  if (!alert_enabled) {
    return;
  }

  unsigned long now = millis();
  if (now < next_alert_change) {
    return;
  }

  buzzer_on = !buzzer_on;
  digitalWrite(9, buzzer_on ? HIGH : LOW);
  next_alert_change = now + (buzzer_on ? 300 : 150);
}