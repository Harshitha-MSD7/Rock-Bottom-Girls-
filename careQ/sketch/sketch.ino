#include <Arduino_RouterBridge.h>

// Drive the active buzzer connected to Arduino digital pin 9.
void beep() {
  digitalWrite(9, HIGH);
  delay(300);
  digitalWrite(9, LOW);
}

// Play three short beeps for an alert event.
void alert(){
  Serial.println("beeping start");
  beep();
  delay(100);
  beep();
  delay(100);
  beep();
}

void setup() {
  // Initialize serial logging, the buzzer pin, and Python-to-MCU RPC handlers.
  Serial.begin(115200);
  pinMode(9, OUTPUT);
  digitalWrite(9, LOW);

  Bridge.begin();
  Bridge.provide("beep", beep);
  Bridge.provide("alert", alert);
  Serial.println("MCU ready: beep on pin 9");
}

// Bridge callbacks are event-driven, so no polling is needed here.
void loop() {}