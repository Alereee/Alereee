<p align="center">
  <img src="../.github/assets/main-readme-logo.svg" alt="شعار Vocab Bloom Hub" />
</p>

<h1 align="center">Vocab Bloom Hub</h1>

<p align="center">
  قاموس إنجليزي مستضاف ذاتيًا: 300 000 مدخل مع المعاني والأمثلة والصيغ الصرفية والترجمات والروابط بين الكلمات، خلف واجهة برمجية عامة ولوحة إدارة وحزمتي SDK وموقع إلكتروني ومجموعة بيانات مفتوحة.
</p>

<p align="center">
  <a href="https://vocab-bloom-hub.com/ar"><strong>vocab-bloom-hub.com</strong></a> ·
  <a href="https://vocab-bloom-hub.com/ar/docs">التوثيق</a> ·
  <a href="https://vocab-bloom-hub.com/ar/api">مرجع API</a> ·
  <a href="https://vocab-bloom-hub.com/ar/playground">ساحة التجربة</a>
</p>

<p align="center">
  <a href="../README.md">🇺🇸 EN</a> | <a href="README.ru.md">🇷🇺 RU</a> | <a href="README.es.md">🇪🇸 ES</a> | <a href="README.fr.md">🇫🇷 FR</a> | <a href="README.pt.md">🇵🇹 PT</a> | <a href="README.de.md">🇩🇪 DE</a> | <a href="README.zh.md">🇨🇳 ZH</a> | <strong>🌐 AR</strong>
</p>

<p align="center">
  <a href="https://github.com/Fristail27/vocab-bloom-hub/actions/workflows/check-pull-request.yml"><img src="https://github.com/Fristail27/vocab-bloom-hub/actions/workflows/check-pull-request.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="https://github.com/Fristail27/vocab-bloom-hub/actions/workflows/codeql.yml"><img src="https://github.com/Fristail27/vocab-bloom-hub/actions/workflows/codeql.yml/badge.svg?branch=main" alt="CodeQL" /></a>
  <a href="../LICENSE"><img src="https://img.shields.io/github/license/Fristail27/vocab-bloom-hub" alt="الترخيص: MIT" /></a>
  <a href="../DATA_LICENSE.md"><img src="https://img.shields.io/badge/data-CC%20BY%204.0-lightgrey" alt="البيانات: CC BY 4.0" /></a>
  <a href="https://www.npmjs.com/package/@vocab-bloom-hub/client"><img src="https://img.shields.io/npm/v/%40vocab-bloom-hub%2Fclient?logo=npm&label=npm" alt="npm: @vocab-bloom-hub/client" /></a>
  <a href="https://pypi.org/project/vocab-bloom-hub/"><img src="https://img.shields.io/pypi/v/vocab-bloom-hub?logo=pypi&logoColor=white" alt="PyPI: vocab-bloom-hub" /></a>
  <a href="https://github.com/Fristail27/vocab-bloom-hub/commits/main"><img src="https://img.shields.io/github/last-commit/Fristail27/vocab-bloom-hub" alt="آخر إيداع" /></a>
  <a href="https://github.com/Fristail27/vocab-bloom-hub/issues"><img src="https://img.shields.io/github/issues/Fristail27/vocab-bloom-hub" alt="المشكلات المفتوحة" /></a>
  <a href="https://github.com/Fristail27/vocab-bloom-hub/pulls"><img src="https://img.shields.io/github/issues-pr/Fristail27/vocab-bloom-hub" alt="طلبات السحب المفتوحة" /></a>
  <a href="https://github.com/Fristail27/vocab-bloom-hub/stargazers"><img src="https://img.shields.io/github/stars/Fristail27/vocab-bloom-hub?style=flat" alt="النجوم" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white" alt="Node >= 22" />
  <img src="https://img.shields.io/badge/yarn-4-2C8EBB?logo=yarn&logoColor=white" alt="Yarn 4" />
  <img src="https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/NestJS-12-E0234E?logo=nestjs&logoColor=white" alt="NestJS 12" />
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/tests-Jest%20%7C%20Playwright-C21325?logo=jest&logoColor=white" alt="Jest وPlaywright" />
  <a href="../CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="طلبات السحب مرحّب بها" /></a>
  <a href="../CODE_OF_CONDUCT.md"><img src="https://img.shields.io/badge/code%20of%20conduct-Contributor%20Covenant-5E0D73.svg" alt="Contributor Covenant" /></a>
</p>

---

## 📖 ما هو

خادم قاموس تشغّله بنفسك. يأتي مع البيانات، وواجهة برمجية لقراءتها، ولوحة إدارة
لتحريرها، وحزم SDK للبناء عليها.

**القاموس**

- 89 000 كلمة إنجليزية و26 000 عبارة، و161 000 معنى مع التعريفات والأمثلة
- النسخ الصوتي IPA، ومستوى CEFR، ووسوم السجل اللغوي والمجال، والصيغ الصرفية
- روابط الترادف والتضاد بين المداخل الرئيسية، والأفعال المركبة مرتبطة بفعلها الأساسي
- ترجمات إلى الروسية والإسبانية والفرنسية والألمانية والبرتغالية والصينية والعربية
- بيانات مفتوحة: [CC BY 4.0](../DATA_LICENSE.md)، منشورة على HuggingFace، وتُحمَّل في نسخة
  فارغة عند التشغيل الأول؛ مولَّدة بنماذج لغوية وغير مراجَعة بشريًا

**الواجهة البرمجية** — `/api/v1`، للقراءة فقط، بلا مفاتيح

- بحث بمستويات صلة وتسامح مع الأخطاء الإملائية؛ مدخل رئيسي مع كل ما يرتبط به
- قوائم مصفّاة بترقيم صفحات بالمؤشر، ومدخل عشوائي، وبحث دفعي يصل إلى 50 كلمة
- تحديد للمعدل لكل عميل، وكل إجابة مخزَّنة مؤقتًا مع ETag، ووثيقة OpenAPI للتوليد منها

**حزم SDK** — مولَّدة من وثيقة OpenAPI تلك

- Node.js / TypeScript: `npm install @vocab-bloom-hub/client`
- Python: `pip install vocab-bloom-hub` (متزامن، وغير متزامن، ومساعد لـ pandas)

**لوحة الإدارة** — ثماني لغات للواجهة

- تحرير الكلمات والمعاني والترجمات والروابط؛ كل تغيير يُحفظ في سجل مع القيم قبل التعديل وبعده،
  يظهر للقراء ويمكن التراجع عنه بنقرة
- الإشراف على التصحيحات التي يرسلها القرّاء من صفحات الكلمات
- تشغيل طلبات جماعية إلى نموذج لغوي على شريحة مصفّاة من القاموس
- استيراد القاموس بأكمله وتصديره كمجموعة بيانات، عبر الإنترنت أو من ملف

**الموقع الإلكتروني** — الوثائق، ومرجع الواجهة البرمجية، وساحة تجربة، وصفحات كلمات عامة

**تحت الغطاء** — PostgreSQL (وSQLite للتطوير)، وصور Docker، وترحيلات عند التشغيل،
ومسابر صحة، ومقاييس Prometheus، وسجلات JSON.

> [!NOTE]
> الحالة: `1.0`، إصدار مستقر: تتبع الواجهة البرمجية العامة تحت `/api/v1` نظام الإصدارات الدلالي؛ وأي تغيير غير متوافق يعني إصدارًا رئيسيًا جديدًا.

---

## ⚡ البدء

ثلاث طرق للبدء، من الأسرع إلى الأكثر مرونة. تنتهي جميعها بلوحة الإدارة والواجهة
البرمجية والقاموس محمَّلًا: مع Docker على <http://localhost:3241> و<http://localhost:3240>،
وبدونه على <http://localhost:3000> و<http://localhost:3010>.

### 1. تشغيل الصور المنشورة

لا حاجة إلى نسخة من المستودع — مجلد واحد، وملفان، وDocker:

```bash
mkdir vocab-bloom-hub && cd vocab-bloom-hub
curl -fsSLO https://raw.githubusercontent.com/Fristail27/vocab-bloom-hub/main/docker-compose.yml
curl -fsSL  https://raw.githubusercontent.com/Fristail27/vocab-bloom-hub/main/.env.example -o .env
```

افتح `.env` وعيّن كلمتي مرور: `ADMIN_PASSWORD` (تسجيل دخول المدير) و`POSTGRES_PASSWORD`
(قاعدة البيانات المضمّنة). ثم:

```bash
docker compose up -d
```

التشغيل الأول ينزّل القاموس ويستورده — بضع دقائق. يجيب `GET /api/ready` بـ `503` إلى أن
يكتمل الاستيراد وبـ `200` بعده؛ ثم سجّل الدخول بـ `ADMIN_USERNAME` / `ADMIN_PASSWORD`
من `.env`.

```bash
curl -s localhost:3240/api/ready            # {"status":"ok"}
curl -s localhost:3240/api/v1/words/run     # القاموس يجيب

# البحث: المداخل المطابقة، وأفضلها أولًا
curl -s 'localhost:3240/api/v1/search?search=run&limit=5'
# الشيء نفسه مع المعاني والأمثلة والترجمات
curl -s 'localhost:3240/api/v1/search/detailed?search=run&with_meanings=true'
```

> [!TIP]
> لتثبيت إصدار محدد بدلًا من بناء التطوير `main`، عيّن `VBH_TAG=1.0.0` في `.env`.
> لإضافة الموقع الإلكتروني (الوثائق، ومرجع الواجهة البرمجية، وساحة التجربة، وصفحات الكلمات) على
> <http://localhost:3242>، عيّن `COMPOSE_PROFILES=db,site`.

### 2. التشغيل من المستودع

ملف compose نفسه، مبنيًا من المصادر — لنسخة fork أو لتغيير لم يُنشر بعد:

```bash
git clone https://github.com/Fristail27/vocab-bloom-hub.git
cd vocab-bloom-hub
cp .env.example .env                           # كلمتا المرور نفسهما
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

### 3. التشغيل بدون Docker

تشغيل إنتاجي على الجهاز نفسه: Node.js 22.13+، وYarn 4 (`corepack enable`)، وPostgres
يمكنك الوصول إليه ([`docs/database.md`](database.md)).

```bash
git clone https://github.com/Fristail27/vocab-bloom-hub.git
cd vocab-bloom-hub
yarn install
printf 'NODE_ENV=production\nDATABASE_URL=postgres://user:password@localhost:5432/vocab_bloom\nADMIN_USERNAME=admin\nADMIN_PASSWORD=change-me\nNEXT_PUBLIC_BASE_API_URL=http://localhost:3010/api\nDICTIONARY_AUTO_IMPORT=true\n' > .env
yarn build && yarn start                       # الواجهة البرمجية :3010، لوحة الإدارة :3000؛ القاموس يحمّل نفسه عند التشغيل الأول
yarn site:build && yarn start:site             # الموقع الإلكتروني :3020، اختياري، في طرفية أخرى
```

خلف نطاق وTLS، مع systemd أو PM2: [`docs/deployment/`](deployment/README.md).

### للتطوير

لا حاجة إلى قاعدة بيانات: بدون `DATABASE_URL` يستخدم الخادم ملف SQLite محليًا، ويُعاد
تشغيل كل تطبيق عند التغيير.

```bash
printf 'NODE_ENV=development\nADMIN_USERNAME=admin\nADMIN_PASSWORD=change-me\nNEXT_PUBLIC_BASE_API_URL=http://localhost:3010/api\n' > .env
yarn dev                                       # الواجهة البرمجية :3010، لوحة الإدارة :3000، الموقع الإلكتروني :3020
```

> [!IMPORTANT]
> حمّل القاموس عبر _Import dictionary_ في لوحة الإدارة.

كل ما تبقى للمساهمين: [`CONTRIBUTING.md`](../CONTRIBUTING.md).

### الخطوات التالية

- التوثيق في صورة موقع، مع مرجع API وساحة للتجربة:
  [vocab-bloom-hub.com](https://vocab-bloom-hub.com/ar/docs).
- نشره على خادم: [`docs/deployment/`](deployment/README.md) — TLS ووكيل عكسي،
  وsystemd / PM2، والترقيات.
- قاعدة البيانات: [`docs/database.md`](database.md) — متطلبات Postgres، والترحيلات،
  والنسخ الاحتياطي، وتقدير الحجم.
- كل إعداد: [`docs/environment.md`](environment.md).
- المقاييس والسجلات: [`docs/observability.md`](observability.md) — Prometheus وGrafana
  بأمر واحد، أو ما لديك.
- قراءة البيانات: [`docs/api.md`](api.md)، وحزمتا SDK لـ [Node.js](../packages/npm-sdk/README.md)
  و[Python](../packages/python-sdk/README.md).

---

## 🤝 المساهمة

المساهمات مرحّب بها. يحتوي [`CONTRIBUTING.md`](../CONTRIBUTING.md) على سير العمل (أسماء
الفروع، ورسائل الإيداع، وقائمة تحقق طلب السحب)، والحزمة التقنية وبنية المستودع، وكل
سكربت، وفهرس الوثائق وخارطة الطريق؛ وتنطبق [مدونة قواعد السلوك](../CODE_OF_CONDUCT.md)
على كل تفاعل. وجدت خطأ أو لديك فكرة؟ افتح
[مشكلة (issue)](https://github.com/Fristail27/vocab-bloom-hub/issues/new/choose) — القوالب
ترشدك.

---

## 📄 الترخيص

- **الكود** — [MIT](../LICENSE) © Aleksei Ryzhov (Fristail27)
- **بيانات القاموس** (ملفات التصدير، والواجهة البرمجية العامة، ومجموعة بيانات HuggingFace) — [CC BY 4.0](../DATA_LICENSE.md): حرة الاستخدام والتعديل، بما في ذلك تجاريًا، مع نسب العمل إلى مصدره.

> [!IMPORTANT]
> البيانات مولَّدة إلى حد كبير بنماذج LLM وغير مراجَعة بشريًا — راجع
> [`data.md`](data.md) قبل الاعتماد عليها.
