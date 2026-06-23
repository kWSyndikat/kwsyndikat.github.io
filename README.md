# kWSyndikat VESC-O-Meter

Frontend-only VESC 7.0 Telemetrie-Subsite fuer Handys. Die App ist optisch an
`https://kwsyndikat.github.io/` angelehnt und laeuft komplett im Browser ueber
Web Bluetooth.

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

Dann `http://localhost:8080/vescometer.html` in Chrome oder Edge oeffnen.

## Daten

Die App nutzt Web Bluetooth mit Nordic UART UUIDs:

- Service: `6e400001-b5a3-f393-e0a9-e50e24dcca9e`
- RX Write: `6e400002-b5a3-f393-e0a9-e50e24dcca9e`
- TX Notify: `6e400003-b5a3-f393-e0a9-e50e24dcca9e`

Gesendet werden:

- `COMM_GET_VALUES` fuer Live-Telemetrie
- `COMM_GET_MCCONF_TEMP` fuer Motor poles, Gear ratio, Wheel diameter und Max ERPM
- `COMM_GET_MCCONF` fuer Battery voltage min/max/cut limits
- `COMM_GET_APPCONF` als App-Config Read und Verbindungscheck

Geparst werden unter anderem:

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

Speed und Distance nehmen automatisch die Setup-Werte aus dem VESC. Halte die
km/h-Anzeige 3 Sekunden gedrueckt, um auf GPS km/h umzuschalten. GPS nutzt die
Browser-Geolocation und braucht die entsprechende Handy-Berechtigung.
