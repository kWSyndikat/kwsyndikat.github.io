# VESC-O-Meter

Frontend-only Webapp fuer VESC 7.0 Telemetrie ueber BLE.

## Start

Oeffne `index.html` direkt oder hoste den Ordner lokal. Fuer Web Bluetooth ist `localhost` oder HTTPS am besten.

Wenn kein Server installiert ist, reicht PowerShell:

```powershell
$root = "C:\Users\Administrator\Documents\VESC-O-Meter"
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:8080/")
$listener.Start()
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $path = $ctx.Request.Url.AbsolutePath.TrimStart("/")
  if ([string]::IsNullOrWhiteSpace($path)) { $path = "index.html" }
  $file = Join-Path $root $path
  if (Test-Path $file) {
    $bytes = [System.IO.File]::ReadAllBytes($file)
    $ctx.Response.ContentType = switch ([IO.Path]::GetExtension($file)) {
      ".css" { "text/css" }
      ".js" { "application/javascript" }
      default { "text/html" }
    }
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } else {
    $ctx.Response.StatusCode = 404
  }
  $ctx.Response.Close()
}
```

Dann `http://localhost:8080` in Chrome oder Edge oeffnen.

## Daten

Die App nutzt Web Bluetooth mit Nordic UART UUIDs:

- Service: `6e400001-b5a3-f393-e0a9-e50e24dcca9e`
- RX Write: `6e400002-b5a3-f393-e0a9-e50e24dcca9e`
- TX Notify: `6e400003-b5a3-f393-e0a9-e50e24dcca9e`

Gesendet wird `COMM_GET_VALUES`. Geparst werden unter anderem:

- Battery Voltage
- Motor Temp
- ESC / Mosfet Temp
- Current
- Power
- Duty
- RPM
- Trip Distance
- Ah Drawn
- Wh/km Consumption
- Mosfet Heat now / average / maximum

Speed und Distance brauchen Fahrzeugwerte. Stelle in der UI Wheel diameter, Motor poles und Gear ratio passend ein.
