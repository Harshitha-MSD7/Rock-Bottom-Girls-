#include <Arduino_RouterBridge.h>

void beep() {
  Serial.println("beep: start");
  digitalWrite(9, HIGH);
  delay(500);
  digitalWrite(9, LOW);
  Serial.println("beep: end");
}

void setup() {
  Serial.begin(115200);
  pinMode(9, OUTPUT);
  digitalWrite(9, LOW);

  Bridge.begin();
  Bridge.provide("beep", beep);
  Serial.println("MCU ready: beep on pin 9");
}

void loop() {}