/*
  DRISHTI · Arduino · DMS/1 Actuator Bridge
  Controls L298N motor driver and buzzer/LED for the DRISHTI exhibition demo.
  
  Connections:
    ENA  -> D5     (PWM speed control)
    IN1  -> D6     (motor direction)
    IN2  -> D7     (motor direction)
    Buzzer/LED -> D9  (cabin alert)
  
  Protocol: DMS/1
  Serial baud: 9600
  Command format: <ACTION>:<VALUE>
  
  Actions:
    boot:all-off    -> all outputs off
    motor:on        -> haptic motor on (uses last PWM value)
    motor:off       -> haptic motor off
    alert:on        -> buzzer/LED on
    alert:off       -> buzzer/LED off
    pwm:<0-255>     -> set motor PWM speed
    status          -> report current state
*/

const int ENA = 5;   // PWM speed control
const int IN1 = 6;   // Motor direction
const int IN2 = 7;   // Motor direction
const int ALERT = 9; // Buzzer/indicator LED

// Motor state
int motorPower = 0;
bool motorOn = false;
bool alertOn = false;

void setup() {
  pinMode(ENA, OUTPUT);
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  pinMode(ALERT, OUTPUT);

  // Safe default: all off
  digitalWrite(ENA, LOW);
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, LOW);
  digitalWrite(ALERT, LOW);

  Serial.begin(9600);
  // Report ready state
  Serial.println("DMS/1 bridge ready · 9600 baud · all outputs off");
}

void loop() {
  if (Serial.available() > 0) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    processCommand(line);
  }
}

void processCommand(String cmd) {
  int sep = cmd.indexOf(':');
  if (sep < 0) return;

  String action = cmd.substring(0, sep);
  String value = cmd.substring(sep + 1);

  if (action == "boot") {
    if (value == "all-off") {
      allOff();
      Serial.println("all outputs off");
    }
  }
  else if (action == "motor") {
    if (value == "on") {
      motorOn = true;
      analogWrite(ENA, motorPower);
      Serial.print("haptic motor on · PWM ");
      Serial.println(motorPower);
    }
    else if (value == "off") {
      motorOn = false;
      digitalWrite(ENA, LOW);
      Serial.println("haptic motor off");
    }
  }
  else if (action == "alert") {
    if (value == "on") {
      alertOn = true;
      digitalWrite(ALERT, HIGH);
      Serial.println("cabin alert on");
    }
    else if (value == "off") {
      alertOn = false;
      digitalWrite(ALERT, LOW);
      Serial.println("cabin alert off");
    }
  }
  else if (action == "pwm") {
    int p = value.toInt();
    if (p >= 0 && p <= 255) {
      motorPower = p;
      if (motorOn) analogWrite(ENA, motorPower);
      Serial.print("PWM set to ");
      Serial.println(p);
    }
  }
  else if (action == "status") {
    Serial.print("state: mode=");
    Serial.print(motorOn ? "MOTOR_ON" : "MOTOR_OFF");
    Serial.print(" alert=");
    Serial.print(alertOn ? "ALERT_ON" : "ALERT_OFF");
    Serial.print(" pwm=");
    Serial.println(motorPower);
  }
}

void allOff() {
  motorOn = false;
  alertOn = false;
  digitalWrite(ENA, LOW);
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, LOW);
  digitalWrite(ALERT, LOW);
  motorPower = 0;
}