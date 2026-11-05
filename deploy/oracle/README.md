# Pulse на Oracle Cloud Always Free

Бесплатный сервер навсегда: ARM-машина Oracle (до 4 ядер и 24 ГБ памяти бесплатно) держит Pulse
круглосуточно, без мака. Ниже — по шагам, для человека, который ни разу не заводил сервер.
Займёт около часа, из них полчаса — ожидание.

Что понадобится: банковская карта (Oracle проверяет её при регистрации и списывает и сразу
возвращает около $1; на тарифе Always Free денег не берут), телефон, почта и SSH-ключ (шаг 3).

## 1. Аккаунт

1. Открой <https://www.oracle.com/cloud/free/> → **Start for free**.
2. Страна — твоя настоящая, данные — как в карте, иначе проверка не пройдёт.
3. **Home Region — не США.** Регион выбирается один раз и навсегда, а Binance отвечает 451 на
   запросы с американских адресов, и Pulse просто не получит данных. Бери европейский:
   **Germany Central (Frankfurt)**, **Netherlands Northwest (Amsterdam)**, **Sweden Central
   (Stockholm)** или **UK South (London)**. Если в одном из них потом не будет свободных ARM-машин
   (шаг 4), сменить регион нельзя, так что лучше сразу брать менее популярный (Стокгольм, Амстердам).
4. Дождись письма «Your account is ready» (бывает от нескольких минут до суток) и войди в
   консоль: <https://cloud.oracle.com>.

## 2. Домен

Сайту нужно имя, чтобы получить HTTPS-сертификат. Бесплатно — DuckDNS:

1. <https://www.duckdns.org> → войти через GitHub или Google.
2. Придумай поддомен (например, `mypulse`) → **add domain**. Получится `mypulse.duckdns.org`.
3. Скопируй **token** вверху страницы — он пойдёт в шаг 4. IP пока не важен: сервер сам
   впишет свой адрес при первом запуске и будет обновлять его раз в 10 минут.

Свой домен тоже подойдёт: тогда после шага 4 создай у регистратора A-запись на публичный IP
сервера, а `DUCKDNS_TOKEN` оставь пустым.

## 3. SSH-ключ

Ключ — это пара файлов: закрытый остаётся у тебя, открытый кладётся на сервер. Пароля для входа
на сервер не будет вообще.

На маке в Терминале:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/oracle_pulse -C "pulse"
```

На вопрос о passphrase можно просто нажать Enter дважды. Открытый ключ — это файл
`~/.ssh/oracle_pulse.pub`, его содержимое покажет:

```bash
cat ~/.ssh/oracle_pulse.pub
```

## 4. Сервер

Консоль Oracle → меню ☰ → **Compute** → **Instances** → **Create instance**.

1. **Name**: `pulse`.
2. **Image and shape** → **Edit**:
   - **Change image** → **Ubuntu** → **Canonical Ubuntu 24.04** (сборка **aarch64**) → Select.
   - **Change shape** → **Ampere** → **VM.Standard.A1.Flex**, 2 OCPU и 12 GB памяти (бесплатно
     до 4 OCPU и 24 GB на все машины вместе) → Select. Значок **Always Free-eligible** должен
     быть виден.
3. **Networking**: оставь как есть (создастся новая сеть), **Assign a public IPv4 address** —
   включено.
4. **Add SSH keys** → **Paste public keys** → вставь строку из `oracle_pulse.pub`.
5. **Boot volume**: по умолчанию 47 GB, хватит (бесплатно до 200 GB).
6. **Show advanced options** → вкладка **Management** → **Initialization script** →
   **Paste cloud-init script**. Открой файл [`cloud-init.yaml`](cloud-init.yaml), заполни в нём
   `PULSE_DOMAIN=mypulse.duckdns.org` и `DUCKDNS_TOKEN=...` и вставь его целиком.
7. **Create**.

Если Oracle пишет **Out of capacity for shape VM.Standard.A1.Flex** — в регионе кончились
свободные ARM-машины. Попробуй другой **Availability domain** (AD-2, AD-3) в том же окне, меньше
ядер (1 OCPU и 6 GB тоже работают) или повтори через несколько часов. Перевод аккаунта на
**Pay As You Go** (с привязанной картой) почти всегда снимает эту проблему, а бесплатные лимиты
остаются бесплатными; поставь в **Billing → Budgets** бюджет $1 с письмом, чтобы точно ничего
не списали.

Через минуту машина в статусе **Running**; скопируй её **Public IP address**.

## 5. Открыть порты в сети Oracle

У Oracle два файрвола: на самой машине (его настраивает скрипт) и в облачной сети. Второй
по умолчанию пускает только SSH.

Instances → `pulse` → в разделе **Primary VNIC** ссылка **Subnet** → **Security Lists** →
**Default Security List** → **Add Ingress Rules**, три правила, у каждого **Source CIDR**
`0.0.0.0/0`:

| IP Protocol | Destination Port Range | Зачем |
|---|---|---|
| TCP | 80 | сертификат Let's Encrypt и переход на HTTPS |
| TCP | 443 | сайт |
| UDP | 443 | HTTP/3 |

## 6. Дождаться установки

Первый запуск сам ставит Docker, файрвол, автообновления, создаёт пользователя `pulse`,
клонирует Pulse в `/opt/pulse`, генерирует пароль базы в `/opt/pulse/.env` и запускает стек из
готовых образов CI (если образа этого коммита ещё нет — собирает его). Это 5–15 минут. Посмотреть, как идёт:

```bash
ssh -i ~/.ssh/oracle_pulse ubuntu@IP
sudo tail -f /var/log/cloud-init-output.log
```

В конце будет `Done. https://mypulse.duckdns.org` и `Pulse setup finished`. Выход — Ctrl+C,
потом `exit`.

Проверь, что биржа отвечает серверу (должно быть `200`, а не `451`):

```bash
ssh -i ~/.ssh/oracle_pulse ubuntu@IP 'curl -s -o /dev/null -w "%{http_code}\n" https://fapi.binance.com/fapi/v1/ping'
```

Открой `https://mypulse.duckdns.org` — это Pulse. Сертификат Caddy получает сам в первые минуту-две.

## 7. Telegram и прочие настройки

Все настройки — в `/opt/pulse/.env` (образец с пояснениями — [`.env.example`](../../.env.example)):

```bash
ssh -i ~/.ssh/oracle_pulse pulse@IP
nano /opt/pulse/.env          # вписать PULSE_TELEGRAM_*, сохранить: Ctrl+O, Enter, Ctrl+X
cd /opt/pulse && docker compose -f compose.prod.yaml up -d
```

Запас по зрителям. По умолчанию стек рассчитан на мак: 1.5 ГБ бэкенду и 300 стримов терминала
(лендинг стрим не держит). У A1 с 12 ГБ запас больше — впиши в `/opt/pulse/.env` и перезапусти:

```
PULSE_BACKEND_MEMORY=3g
PULSE_STREAM_CLIENTS=800
```

Перед роликом проверь на самом сервере, что всплеск выдерживается: `loadtest/run.sh burst -e
ARRIVALS=1000` (`loadtest/README.md`), отказов должно быть 0, память бэкенда — с запасом от лимита.

## 8. Деплой из GitHub на каждый мерж

Workflow `ci.yml` после зелёных тестов на `main` заходит на сервер пользователем `pulse` и
делает `git pull` и `docker compose up -d --build`. Для этого ему нужен свой ключ — отдельный от
твоего, чтобы его можно было отозвать.

1. На маке создай ключ для деплоя:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/pulse_deploy -C "github-deploy" -N ""
   ```
2. Добавь открытый ключ пользователю `pulse` на сервере:
   ```bash
   ssh -i ~/.ssh/oracle_pulse pulse@IP 'cat >> ~/.ssh/authorized_keys' < ~/.ssh/pulse_deploy.pub
   ```
3. GitHub → репозиторий → **Settings** → **Secrets and variables** → **Actions** →
   **New repository secret**, три секрета:

   | Имя | Значение |
   |---|---|
   | `VPS_HOST` | публичный IP сервера (или домен) |
   | `VPS_SSH_KEY` | содержимое `~/.ssh/pulse_deploy` (закрытый ключ, целиком, со строками BEGIN/END) — `pbcopy < ~/.ssh/pulse_deploy` |
   | `VPS_KNOWN_HOSTS` | вывод `ssh-keyscan IP` |

Следующий мерж в `main` развернётся сам: в Actions у прогона `ci` появится шаг **Deploy over SSH**
(сначала дамп базы, потом новая версия).
Руками то же самое делает `deploy/deploy.sh pulse@IP`.

**Готовые образы вместо сборки на сервере.** Сборка Java на двух ядрах A1 идёт 5–10 минут и
съедает память, пока работает старая версия. CI на каждый мерж собирает образы под ARM и x86
и кладёт их в GitHub Container Registry с меткой коммита. Чтобы сервер их брал:

1. Образы публичные (как и репозиторий) — сервер скачивает их без пароля; проверено 4 ноября
   2026 на первом мерже: `ghcr.io/addictcode/pulse-backend` и `pulse-web`, под arm64 и amd64.
   Если когда-нибудь `docker pull` ответит `denied`, — GitHub → профиль → **Packages** → пакет →
   **Package settings** → **Change visibility** → **Public**.
2. Первый запуск прописывает их в `/opt/pulse/.env` сам (владелец берётся из адреса репозитория):
   ```
   PULSE_BACKEND_IMAGE=ghcr.io/addictcode/pulse-backend
   PULSE_WEB_IMAGE=ghcr.io/addictcode/pulse-web
   ```
   и уже первый старт скачивает образы, а не собирает их минут десять.

Дальше `deploy/update.sh` (его вызывают и CI, и `deploy/deploy.sh`) скачивает образы ровно этого
коммита. Если их нет — CI ещё собирает или сборка упала, — он соберёт их на месте, как раньше:
старый образ под новой версией кода сервер не запустит. Убери эти две строки — и всё снова
собирается на сервере.

## 9. Переезд с мака

Делается один раз, когда сервер из шагов 1–8 открывается по своему адресу. На маке копилась
статистика сигналов (с 31.10.2026 — чистая, на ней будет повторное исследование), её надо
перенести. Минут 15; пока идёт перенос, сайт по постоянной ссылке показывает демо.

1. **Остановить автозапуск на маке.** Иначе LaunchAgent вернёт постоянную ссылку на туннель:
   ```bash
   deploy/home.sh autostart-off
   ```
2. **Остановить бэкенд на маке и снять последний дамп.** Бот опрашивает Telegram одним
   соединением на токен: если бэкенд работает и на маке, и на сервере, Telegram отвечает 409, а
   посты в канале идут дважды. Поэтому сначала стоп, потом дамп — в нём уже ничего не потеряется:
   ```bash
   docker compose -p pulse -f compose.prod.yaml -f compose.tunnel.yaml stop backend
   docker exec pulse-postgres-1 pg_dump -U pulse -d pulse -Fc > ~/Backups/pulse/pulse-move.dump
   docker exec -i pulse-postgres-1 pg_restore -l < ~/Backups/pulse/pulse-move.dump | grep -c 'TABLE DATA'
   ```
   Последняя команда должна напечатать число больше нуля.
3. **Перенести настройки Telegram.** Строки `PULSE_TELEGRAM_*` и `PULSE_HEARTBEAT_URL` из `.env`
   на маке — в `/opt/pulse/.env` на сервере (шаг 7). `PULSE_DOMAIN`, `POSTGRES_PASSWORD` и
   строки туннеля (`PULSE_SITE_ADDRESS`, `PULSE_HTTP_PORT`, `PULSE_PUBLIC_ORIGIN`) не переносить:
   у сервера свои.
4. **Залить дамп на сервер и восстановить.** На сервере уже есть пустая база, созданная при
   первом запуске. Её пересоздают целиком, а не чистят `--clean`: если на маке были не все
   миграции, таблицы новых остались бы, а журнал Liquibase из дампа о них не знает, и бэкенд не
   запустится («already exists»).
   ```bash
   scp -i ~/.ssh/oracle_pulse ~/Backups/pulse/pulse-move.dump pulse@IP:
   ssh -i ~/.ssh/oracle_pulse pulse@IP
   cd /opt/pulse
   deploy/backup.sh before-move
   docker compose -f compose.prod.yaml stop backend
   docker compose -f compose.prod.yaml exec -T postgres psql -U pulse -d postgres -c 'drop database pulse' -c 'create database pulse owner pulse'
   docker compose -f compose.prod.yaml exec -T postgres pg_restore -U pulse -d pulse --no-owner < ~/pulse-move.dump
   docker compose -f compose.prod.yaml up -d backend
   docker compose -f compose.prod.yaml logs --tail 50 backend
   ```
   В логах Liquibase не должно быть ошибок; если на маке были не все миграции, бэкенд докатит
   остальные сам. На `https://mypulse.duckdns.org/record/` — та же статистика, что была на маке.
5. **Перевести постоянную ссылку на сервер** (с мака, из папки репозитория):
   ```bash
   deploy/home.sh publish https://mypulse.duckdns.org
   ```
   Постоянная ссылка ведёт только на `*.trycloudflare.com` и `*.duckdns.org`; для своего домена
   его надо добавить в проверку адреса в `index.html` в корне репозитория и в `deploy/home.sh`.
6. **Погасить стек на маке.** Данные остаются в Docker-томе — ещё одна копия на всякий случай:
   ```bash
   deploy/home.sh stop
   ```
7. Проверить бота: `/status` должен ответить уже с сервера.

## Резервные копии

Каждую ночь в 03:40 UTC и перед каждым деплоем (`deploy/update.sh`, его вызывают CI и `deploy/deploy.sh`) сервер снимает дамп
базы в `/home/pulse/backups` и хранит две недели; дамп без данных таблиц не сохраняется, а деплой
без удачного дампа не идёт. Журнал — `/home/pulse/backup.log`. Вручную:
`ssh pulse@IP '/opt/pulse/deploy/backup.sh manual'`.

Это защита от неудачной миграции или удаления, но не от потери самого сервера. Раз в неделю
забирай копии на мак:

```bash
rsync -a -e "ssh -i ~/.ssh/oracle_pulse" pulse@IP:backups/ ~/Backups/pulse/server/
```

Восстановить дамп — как в шаге 9.4, с нужным файлом из `backups/`.

## Что настроено на сервере

- **Файрвол**: Oracle в своих образах Ubuntu не использует ufw — у них правила iptables в
  `/etc/iptables/rules.v4`, которые пускают SSH и отклоняют остальное. Скрипт вставляет перед
  отклонением 80/tcp, 443/tcp и 443/udp, сразу и в файл, чтобы пережить перезагрузку. Postgres
  и бэкенд наружу портов не публикуют вовсе.
- **SSH** только по ключу, вход под root запрещён; fail2ban банит перебор.
- **Обновления безопасности** ставятся каждую ночь (`unattended-upgrades`), если нужна
  перезагрузка — в 04:30 UTC; контейнеры поднимаются сами (`restart: unless-stopped`).
- **Своп** 2 ГБ на пик сборки Java-образа.
- **DuckDNS**: cron раз в 10 минут сообщает адрес сервера.
- **Дамп базы** каждую ночь и перед деплоем — раздел «Резервные копии».
- **Пульс для healthchecks.io**: если в `.env` есть `PULSE_HEARTBEAT_URL` (бесплатная проверка
  на healthchecks.io с периодом 1 минута), сервер раз в минуту проверяет свой публичный адрес и,
  если Pulse ответил, пингует её. Пинги прекратились — проверка шлёт письмо или сообщение в
  Telegram, по какой бы причине сайт ни лёг.
- Повторный запуск безопасен: `sudo bash /opt/pulse/deploy/oracle/setup.sh` ничего не
  дублирует и не меняет пароль базы.

## Если что-то не так

- **Сайт не открывается**: проверь правила из шага 5 и что контейнеры живы:
  `cd /opt/pulse && docker compose -f compose.prod.yaml ps`; логи —
  `docker compose -f compose.prod.yaml logs --tail 100 backend` (или `web`).
- **Нет данных, в логах 451**: регион в США. Его не сменить — нужен новый аккаунт в другом регионе.
- **Сертификат не выдаётся**: домен ещё не указывает на сервер (`nslookup mypulse.duckdns.org`
  должен вернуть IP сервера) или закрыт порт 80.
- **Oracle остановил машину за простой**: Always Free-машины, которые неделю почти не грузят
  процессор, Oracle может забрать. Pulse держит стримы биржи и считает рынок каждые 2 секунды,
  так что под это правило не попадает; на аккаунте Pay As You Go правила нет совсем.

## Проверка скрипта

`deploy/oracle/test-in-docker.sh` прогоняет `setup.sh` дважды в чистом контейнере Ubuntu 24.04
с правилами iptables как в образе Oracle и проверяет результат (порты перед отклонением,
пользователь и ключ, SSH, автообновления, `.env`), плюс схему `cloud-init.yaml`. Docker, своп и
systemd в контейнере недоступны, поэтому сам стек там не запускается — это проверяется только на
настоящей машине.
