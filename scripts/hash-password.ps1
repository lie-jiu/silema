# 改管理员口令（Windows 原生）。问口令 → 算哈希 → 打印 + 复制到剪贴板。
#   .\scripts\hash-password.ps1            问两次（明文可见）→ 打印哈希并复制到剪贴板
#   .\scripts\hash-password.ps1 -Hidden    隐藏输入（SecureString）
#   .\scripts\hash-password.ps1 -Apply     写进 .secrets.json 并立即重新部署线上 Worker
#   .\scripts\hash-password.ps1 -Key EMAIL_FROM -Apply
# 双击/右键「使用 PowerShell 运行」时窗口会一闪而过，所以末尾有暂停；自动化用 -NoPause。
param(
  [switch]$Apply,
  [switch]$Hidden,
  [switch]$Rotate,
  [switch]$NoPause,
  [string]$Key = "ADMIN_PASSWORD_HASH"
)

$ErrorActionPreference = "Stop"
$hashed = $Key -eq "ADMIN_PASSWORD_HASH"
$script:ok = $false
$script:tmp = $null

function Read-One([string]$label) {
  if ($Hidden) {
    $m = Read-Host $label -AsSecureString
    return [Runtime.InteropServices.Marshal]::PtrToStringAuto(
      [Runtime.InteropServices.Marshal]::SecureStringToBSTR($m))
  }
  return Read-Host $label
}

try {
  # 让 node 的中文输出在 GBK 控制台上不变成乱码（只影响本进程）
  try { [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false) } catch {}
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "找不到 node，请在装了 Node.js 的机器上运行。" }

  if ($Rotate) {
    if ($hashed) { throw "-Rotate 只用于机器生成的密钥（SESSION_SECRET / CRON_SECRET）；改口令请去掉 -Rotate。" }
    if (-not $Apply) { throw "-Rotate 要配 -Apply 才有意义（随机值只在线上一份，打印出来反而容易漏）。" }
    Write-Host "旋转 $Key 并立即重新部署线上 Worker…" -ForegroundColor Yellow
    node (Join-Path $PSScriptRoot "hash-password.cjs") --key=$Key --rotate --apply --yes
    $script:ok = $true
    return
  }

  # 提示语刻意不写变量名 ADMIN_PASSWORD_HASH —— 那是 Cloudflare Secret 的名字，
  # 看起来像「要你输入哈希」，结果真有人把哈希粘进登录页的密码框。
  $label = if ($hashed) { "输入新口令（是明文口令，不是哈希）" } else { "输入 $Key 的新值" }
  $first = Read-One $label
  if ([string]::IsNullOrEmpty($first)) { throw "空的，已放弃。" }

  $feed = "$first`n"
  if ($hashed) {
    $second = Read-One "再输入一次确认"
    if ($second -ne $first) { throw "两次不一致，已放弃（没有改动任何东西）。" }
    $feed = "$first`n$second`n"
  }

  $js = Join-Path $PSScriptRoot "hash-password.cjs"
  $jsArgs = @($js, "--key=$Key")
  # 绝不走管道：PowerShell 5.1 按 $OutputEncoding（默认不是 UTF-8）把文本写进子进程 stdin，
  # 口令里只要有中文/重音等非 ASCII 字符，node 收到的就是乱码，哈希算的是「另一个字符串」——
  # 表现就是部署成功、可你怎么输都提示「用户名或密码不正确」。改成落一个 UTF-8 无 BOM 的临时文件。
  $script:tmp = Join-Path ([IO.Path]::GetTempPath()) ("silema-pw-" + [guid]::NewGuid().ToString("N").Substring(0, 8) + ".txt")
  [IO.File]::WriteAllText($script:tmp, $feed, [Text.UTF8Encoding]::new($false))
  $jsArgs += "--file=$script:tmp"

  if ($Apply) {
    Write-Host "将写入 .secrets.json 并立即重新部署线上 Worker…" -ForegroundColor Yellow
    node ($jsArgs + @("--apply", "--yes"))
    $script:ok = $true
    return
  }

  $out = @((node $jsArgs 2>&1) | ForEach-Object { "$_" })
  $out | ForEach-Object { Write-Host $_ }
  if (-not $hashed) {
    $script:ok = $true            # 明文变量没有 pbkdf2$ 行，别去找
  } else {
    $line = @($out | Where-Object { $_ -match '^pbkdf2\$' })[0]
    if ($line) {
      Set-Clipboard $line
      Write-Host "`n已复制到剪贴板。这串是「哈希」，只进 Cloudflare Secret：打开 .secrets.json 替换 ADMIN_PASSWORD_HASH 的值，再 npm run deploy -- --secrets-file .secrets.json。" -ForegroundColor Green
      Write-Host "登录页密码框要填的是你刚才输入的明文口令 —— 粘这串哈希进去必然报「密码错误」。嫌麻烦就重跑：.\scripts\hash-password.ps1 -Apply" -ForegroundColor Yellow
      $script:ok = $true
    } else {
      Write-Host "没拿到哈希（上面就是 node 的全部输出）。" -ForegroundColor Red
    }
  }
} catch {
  Write-Host "`n$($_.Exception.Message)" -ForegroundColor Red
} finally {
  $first = $null; $second = $null; $feed = $null   # 口令只活在变量里，用完清掉
  if ($script:tmp) {
    try { [IO.File]::WriteAllText($script:tmp, " "); Remove-Item $script:tmp -Force } catch {}
  }
  if (-not $NoPause) { Read-Host "`n按回车关闭本窗口" | Out-Null }
  exit ($(if ($script:ok) { 0 } else { 1 }))
}
