param(
  [string]$Region = "eu-south-2",
  [string]$Table  = "measurements",
  [string]$DeviceId = "e65eea0c-dedd-48ea-9bd0-509277d6636b",
  [int]$ChunkMs = 500,
  [int]$SamplesPerChunk = 125,   # 250Hz * 0.5s = 125
  [int]$Minutes = 2
)

$TempDir = Join-Path $PSScriptRoot ".tmp"
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
$ItemPath = Join-Path $TempDir "ddb_item.json"

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

function Put-ItemFile([hashtable]$obj) {
  $json = $obj | ConvertTo-Json -Depth 20
  Write-Utf8NoBom -Path $ItemPath -Text $json
  aws dynamodb put-item --region $Region --table-name $Table --item file://$ItemPath | Out-Null
}

function To-DdbNumber([string]$n) { return @{ N = $n } }
function To-DdbString([string]$s) { return @{ S = $s } }

$end = (Get-Date).AddMinutes($Minutes)
$seq = 1
$baseHr = 75.0
$baseEda = 0.20

# ECG señal simulada: seno + ruido
$freqHz = 1.2

Write-Host "Simulating ECG chunks: chunk=${ChunkMs}ms samples=${SamplesPerChunk} (~$([Math]::Round(1000*$SamplesPerChunk/$ChunkMs)) Hz)"

while((Get-Date) -lt $end){
  $ts = [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())

  $t = $seq / 10.0
  $hr  = $baseHr + 6.0 * [Math]::Sin($t) + (Get-Random -Minimum -1.5 -Maximum 1.5)
  $eda = $baseEda + 0.05 * [Math]::Sin($t/2.0) + (Get-Random -Minimum -0.01 -Maximum 0.01)

  # genera ecg
  $ecg = New-Object System.Collections.Generic.List[object]
  for($i=0; $i -lt $SamplesPerChunk; $i++){
    $tt = ($seq * $ChunkMs/1000.0) + ($i * $ChunkMs/1000.0 / $SamplesPerChunk)
    $val = 500 * [Math]::Sin(2*[Math]::PI*$freqHz*$tt) + (Get-Random -Minimum -35 -Maximum 35)
    $ecg.Add(@{ N = ("{0:0}" -f [Math]::Round($val)) })
  }

  $ddb = @{
    device_id = To-DdbString $DeviceId
    ts        = To-DdbNumber "$ts"
    hr        = To-DdbNumber ("{0:0.0}" -f $hr)
    eda       = To-DdbNumber ("{0:0.000}" -f $eda)
    seq       = To-DdbNumber "$seq"
    ecg       = @{ L = $ecg }
  }

  Put-ItemFile $ddb

  if(($seq % 5) -eq 0){
    Write-Host "sent seq=$seq ts=$ts hr=$("{0:0.0}" -f $hr) eda=$("{0:0.000}" -f $eda) ecgN=$SamplesPerChunk"
  }

  $seq++
  Start-Sleep -Milliseconds $ChunkMs
}

Write-Host "Done."
