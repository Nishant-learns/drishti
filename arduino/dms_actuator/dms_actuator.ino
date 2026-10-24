/*
  DRISHTI · Arduino · DMS/1 Actuator Bridge
  Controls L298N motor driver and buzzer/LED for the DRISHTI driver safety system.
  
  Connections:
    ENA  -> D5     (PWM speed control)
    IN1  -> D6     (motor direction pin 1)
    IN2  -> D7     (motor direction pin 2)
    Buzzer/LED -> D9  (cabin alert)
  
  Protocol: DMS/1
  Serial baud: 9600
  Command format:
    ALERT:<1|0|ON|OFF>
    MOTOR:<0-255>:<F|R|S>
    MOTOR:<ON|OFF>
    PWM:<0-255>
    PING
    BOOT:ALL-OFF
    STATUS
*/

const int ENA = 5;   // PWM speed control
const int IN1 = 6;   // Motor direction pin 1
const int IN2 = 7;   // Motor direction pin 2
const int ALERT = 9; // Buzzer / indicator LED

int motorPower = 0;
char motorDir = 'S';
bool motorOn = false;
bool alertOn = false;

void setMotor(int power, char dir) {
  power = constrain(power, 0, 255);
  motorPower = power;
  motorDir = dir;
  
  if (power == 0 || dir == 'S') {
    motorOn = false;
    digitalWrite(IN1, LOW);
    digitalWrite(IN2, LOW);
    analogWrite(ENA, 0);
  } else if (dir == 'R') {
    motorOn = true;
    digitalWrite(IN1, LOW);
    digitalWrite(IN2, HIGH);
    analogWrite(ENA, power);
  } else { // 'F' or default forward
    motorOn = true;
    digitalWrite(IN1, HIGH);
    digitalWrite(IN2, LOW);
    analogWrite(ENA, power);
  }
}

void setAlert(bool on) {
  alertOn = on;
  digitalWrite(ALERT, on ? HIGH : LOW);
}

void allOff() {
  setMotor(0, 'S');
  setAlert(false);
}

void processCommand(String cmd) {
  String upperCmd = cmd;
  upperCmd.toUpperCase();

  if (upperCmd == "PING") {
    Serial.println("PONG");
    return;
  }
  
  if (upperCmd == "STATUS") {
    Serial.print("state: mode=");
    Serial.print(motorOn ? "MOTOR_ON" : "MOTOR_OFF");
    Serial.print(" alert=");
    Serial.print(alertOn ? "ALERT_ON" : "ALERT_OFF");
    Serial.print(" pwm=");
    Serial.print(motorPower);
    Serial.print(" dir=");
    Serial.println(motorDir);
    return;
  }

  int sep = cmd.indexOf(':');
  if (sep < 0) return;

  String action = cmd.substring(0, sep);
  action.toUpperCase();
  String value = cmd.substring(sep + 1);
  String upperVal = value;
  upperVal.toUpperCase();

  if (action == "BOOT") {
    if (upperVal == "ALL-OFF") {
      allOff();
      Serial.println("all outputs off");
    }
  }
  else if (action == "ALERT") {
    if (upperVal == "1" || upperVal == "ON" || upperVal == "TRUE") {
      setAlert(true);
      Serial.println("cabin alert on");
    } else if (upperVal == "0" || upperVal == "OFF" || upperVal == "FALSE") {
      setAlert(false);
      Serial.println("cabin alert off");
    }
  }
  else if (action == "MOTOR") {
    // Check if format is MOTOR:<power>:<direction>
    int sep2 = value.indexOf(':');
    if (sep2 > 0) {
      int p = value.substring(0, sep2).toInt();
      String dirStr = value.substring(sep2 + 1);
      dirStr.toUpperCase();
      char d = (dirStr.length() > 0) ? dirStr.charAt(0) : 'F';
      setMotor(p, d);
      Serial.print("motor power=");
      Serial.print(p);
      Serial.print(" dir=");
      Serial.println(d);
    } else if (upperVal == "ON") {
      setMotor(motorPower > 0 ? motorPower : 180, 'F');
      Serial.print("haptic motor on · PWM ");
      Serial.println(motorPower);
    } else if (upperVal == "OFF") {
      setMotor(0, 'S');
      Serial.println("haptic motor off");
    } else {
      int p = upperVal.toInt();
      setMotor(p, p > 0 ? 'F' : 'S');
      Serial.print("motor set to ");
      Serial.println(p);
    }
  }
  else if (action == "PWM") {
    int p = upperVal.toInt();
    if (p >= 0 && p <= 255) {
      motorPower = p;
      if (motorOn) {
        analogWrite(ENA, motorPower);
      }
      Serial.print("PWM set to ");
      Serial.println(p);
    }
  }
}

void setup() {
  pinMode(ENA, OUTPUT);
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  pinMode(ALERT, OUTPUT);

  allOff();

  Serial.begin(9600);
  Serial.println("DMS/1 bridge ready · 9600 baud · all outputs off");
}

void loop() {
  if (Serial.available() > 0) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    if (line.length() > 0) {
      processCommand(line);
    }
  }
}