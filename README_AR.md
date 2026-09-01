# Moveintrack Production v1.0

Moveintrack هو نظام مركزي متعدد المستخدمين لإدارة الرحلات، اعتمادها حسب المخاطر، التحقق من صلاحية السائقين والسيارات، ومتابعة الرحلات من خلال Control Room مع سجل مراجعة دائم.

هذه الحزمة ليست ملف HTML تجريبيًا. هي تطبيق Web كامل يتكون من:

- واجهة Moveintrack متجاوبة وتعمل كتطبيق PWA.
- Backend API مبني باستخدام FastAPI.
- PostgreSQL كقاعدة بيانات Production.
- Login مستقل بالبريد وكلمة المرور؛ لا يحتاج Windows Domain.
- Multi-Factor Authentication باستخدام تطبيقات TOTP مع Recovery Codes.
- صلاحيات Server-side حسب الدور.
- HTTPS Reverse Proxy باستخدام Caddy.
- Docker Compose لتشغيل كل المكونات على السيرفر `moveintrack`.
- Scripts للنسخ الاحتياطي والاستعادة.
- اختبارات آلية لدورة الرحلة الكاملة.

## الأدوار

| الدور | الاستخدام |
|---|---|
| Admin | المستخدمون، الإعدادات، السائقون، السيارات، السجلات، وكل العمليات |
| Creator | إنشاء الرحلات وتعديل Draft/Returned الخاصة به |
| Approver | الاعتماد التشغيلي للرحلات |
| HSE | المرحلة الثانية لاعتماد الرحلات High Risk |
| Control | بدء الرحلة، المتابعة، Check-in، الوصول والإغلاق |
| Viewer | العرض والتقارير فقط |

## تشغيل سريع للاختبار المحلي

يلزم Python 3.13 أو إصدار متوافق.

```powershell
cd Moveintrack_Production_v1
python -m pip install -r requirements.txt
powershell -ExecutionPolicy Bypass -File scripts/run-local.ps1
```

ثم افتح:

```text
http://localhost:8000
```

بيانات أول Admin تُقرأ من Environment Variables. القيم الافتراضية المحلية:

```text
Email: admin@moveintrack.app
Password: ChangeMe!2026
```

يجب تغيير كلمة المرور فورًا.

## تشغيل Production على السيرفر moveintrack

### المتطلبات

1. Docker Engine وDocker Compose.
2. اسم خارجي حقيقي مثل `moveintrack.company.com`.
3. DNS A Record يشير إلى Public IP الخاص بالشركة.
4. تحويل Port 80 و443 من الـFirewall إلى السيرفر `moveintrack`.
5. Split DNS أو Internal DNS يجعل نفس الاسم يعمل من داخل الشركة.
6. مساحة منفصلة للـBackup خارج نفس السيرفر.

### الخطوات

1. انسخ الحزمة إلى السيرفر.
2. انسخ ملف الإعدادات:

```bash
cp .env.production.template .env
```

3. عدّل `.env` واستبدل كل القيم المؤقتة بكلمات مرور قوية واسم الـDomain الحقيقي.
4. عند التشغيل تُنفذ Database Migrations تلقائيًا قبل بدء التطبيق.
5. شغّل:

```bash
docker compose up -d --build
```

6. تحقق من الحالة:

```bash
docker compose ps
docker compose logs -f app
```

7. افتح `https://moveintrack.company.com` وسجّل بحساب الـAdmin.
8. أنشئ مستخدمًا واحدًا على الأقل لكل من Approver وHSE وControl وCreator.
9. فعّل MFA لكل المستخدمين ثم اجعله Mandatory من System Center.
10. أدخل سيارة وسائقًا صالحين.
11. افتح System Center وتأكد أن Go-Live Readiness = 100%.

## النسخ الاحتياطي

Linux:

```bash
./scripts/backup.sh
```

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/backup.ps1
```

يوصى بجدولة Backup يومي ونقل نسخة إلى Storage آخر. يجب تنفيذ Restore Test قبل Go-Live ثم بصورة دورية.

## الاختبارات

```bash
PYTHONPATH=. pytest -q
```

الاختبار الآلي الحالي يغطي:

- إنشاء المستخدمين وتطبيق الأدوار.
- إنشاء سيارة وسائق صالحين.
- إنشاء رحلة وإرسالها.
- الاعتماد.
- بدء الرحلة.
- Check-in.
- الوصول والإغلاق.
- وجود Audit Trail.

## ما لا يمكن إكماله داخل الحزمة وحدها

الحزمة جاهزة تقنيًا للتثبيت، لكن التشغيل الخارجي النهائي يتطلب معلومات وبنية لا يمكن إنشاؤها بدون صلاحيات الشركة:

- اسم Domain الفعلي وDNS.
- Public IP وFirewall/NAT.
- سياسات الشركة للأمن والنسخ الاحتياطي.
- SMTP إذا كان مطلوبًا إرسال بريد خارجي.
- GPS provider إذا كان مطلوبًا تتبع الموقع تلقائيًا.
- Penetration Test واعتماد UAT من مستخدمي الشركة.

النظام يعمل حاليًا بإشعارات داخلية، MFA، وCheck-in يدوي من Control Room. هذه الوظائف كافية لبدء تشغيل Production Controlled Go-Live، بينما Email/SMS والتتبع التلقائي من مزود GPS تعتبر Integrations إضافية وليست شرطًا لتشغيل Core V1.
