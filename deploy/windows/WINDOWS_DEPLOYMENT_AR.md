# نشر Moveintrack على Windows Server باسم moveintrack

## المكونات

- Windows Server محدث.
- Python 3.13 x64.
- PostgreSQL 16 أو إصدار مدعوم.
- IIS مع URL Rewrite وApplication Request Routing.
- SSL Certificate للاسم الخارجي.

## 1. تجهيز التطبيق

انسخ الحزمة إلى:

```text
C:\Moveintrack
```

ثم شغّل PowerShell كمسؤول:

```powershell
cd C:\Moveintrack
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item deploy\windows\.env.windows.template deploy\windows\.env.windows
```

عدّل `.env.windows` وضع اسم الـDomain الحقيقي وكلمات المرور.

اقفل صلاحيات الملف بحيث يقرأه Administrators وSYSTEM فقط:

```powershell
icacls deploy\windows\.env.windows /inheritance:r
icacls deploy\windows\.env.windows /grant:r "SYSTEM:(R)" "Administrators:(R)"
```

## 2. PostgreSQL

أنشئ Database باسم `moveintrack` وUser بنفس الاسم، ثم ضع كلمة المرور في `DATABASE_URL`.

اختبر الاتصال من السيرفر قبل تشغيل التطبيق.

## 3. تثبيت التطبيق عند Startup

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\install-scheduled-task.ps1 -AppPath C:\Moveintrack
```

اختبر محليًا:

```text
http://127.0.0.1:8000/api/health
```

يجب أن يرجع `healthy`.

## 4. IIS Reverse Proxy

1. أنشئ Site أو Application Pool مخصصًا باسم Moveintrack.
2. ضع ملف `web.config` المرفق في Physical Path فارغ مخصص للموقع.
3. فعّل Proxy في ARR Server Proxy Settings.
4. اربط HTTPS Binding بالاسم الخارجي والشهادة.
5. لا تفتح Port 8000 على الـFirewall؛ IIS فقط يصل إليه محليًا.

## 5. DNS الداخلي والخارجي

الاسم المقترح:

```text
moveintrack.company.com
```

- Public DNS يشير إلى Public IP.
- Firewall/NAT يحول 443 إلى السيرفر moveintrack.
- Internal DNS يشير بالاسم نفسه إلى Internal IP.

## 6. Backup

شغّل `backup-native.ps1` يدويًا أولًا، ثم أنشئ Scheduled Task يومي. يجب ضبط `PGPASSWORD` بطريقة آمنة أو استخدام PostgreSQL password file للحساب المخصص للنسخ الاحتياطي.

لا تعتبر النسخ الاحتياطية ناجحة قبل تنفيذ Restore Test على Database منفصلة.
