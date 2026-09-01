# تسليم Moveintrack Production v1.0

## نطاق البيئة المعتمد

- الاستخدام: داخل الشركة ومن خارجها.
- اسم السيرفر: `moveintrack`.
- العدد المتوقع: حوالي 25 مستخدمًا.
- لا يوجد اعتماد على Windows Domain.
- الدخول: حساب فردي بالبريد وكلمة المرور وMFA.

## ما تم تسليمه

- تطبيق مركزي متعدد المستخدمين، وليس Local Storage أو HTML Pilot.
- PostgreSQL Production Database مع Database Migrations.
- Backend API يطبق الصلاحيات وقواعد التشغيل على السيرفر.
- واجهة Moveintrack كاملة ومتجاوبة وPWA.
- Login آمن، Sessions مركزية، CSRF، Lockout وRate Limiting.
- MFA باستخدام Authenticator وRecovery Codes.
- Roles: Admin, Creator, Approver, HSE, Control, Viewer.
- Journey Workflow محكوم وقابل للمراجعة.
- اعتماد ثنائي للرحلات High Risk.
- منع Self-Approval.
- Risk Assessment وMandatory Checklist.
- صلاحية السائق والسيارة والمستندات.
- كشف تعارض السائق أو السيارة زمنيًا.
- Control Room وCheck-in ومراقبة التأخير آليًا.
- Notifications داخل النظام.
- Audit Trail دائم.
- إدارة المستخدمين وإعادة تعيين Password وMFA.
- CSV Export وData Snapshot.
- Docker Production Deployment مع Caddy وHTTPS.
- بديل نشر على Windows Server + IIS.
- Backup وRestore scripts.
- UAT Cases وGo-Live Checklist ووثائق Security وArchitecture.

## حالة المنتج

الكود جاهز للتثبيت وإجراء UAT ثم Controlled Go-Live. لا يزال نشره على الإنترنت فعليًا يعتمد على بيانات وصلاحيات البنية التحتية التي لا توجد داخل المحادثة:

1. اسم Domain حقيقي.
2. Public IP وDNS.
3. Firewall/NAT.
4. SSL Binding في حالة IIS، أو السماح لـCaddy بإصدار الشهادة.
5. بيانات SMTP إذا أريد Email Notification.
6. بيانات مزود GPS إذا أريد Live Tracking تلقائيًا.

بدون هذه البيانات لا يمكن ادعاء أن النظام منشور على عنوان عام، لكن الحزمة نفسها جاهزة لتلك الخطوة.

## أول تشغيل

1. انسخ `.env.production.template` إلى `.env`.
2. استبدل كل القيم المؤقتة.
3. نفذ `docker compose up -d --build`.
4. افتح اسم الـDomain وسجل بحساب Admin.
5. غيّر كلمة المرور المؤقتة.
6. أنشئ الأدوار الأساسية.
7. فعّل MFA للجميع واجعله Mandatory.
8. أدخل Master Data.
9. نفذ UAT.
10. تأكد أن Readiness = 100% ثم اعتمد Go-Live.
