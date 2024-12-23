<center><img src=".github/resource/Icons/BG.png" alt="centered image" height="50"></center>


[<img align="right" alt="Avatar" width="350px" src=".github/resource/Icons/Bot.png" />]()

# [`WatKLOK`](https://github.com/SNIPPIK/WatKLOK) 
- Автор: [`SNIPPIK`](https://github.com/SNIPPIK)
- Discord server: [`тут`](https://discord.gg/qMf2Sv3)
- Демонстрация: [`тут`](https://youtu.be/ljOOAQcvirQ)
- Поддерживает плагины
- Доступные платформы: [`тут`](src/handlers/APIs)
- Поддерживаться только /команды
- Все сообщения удаляются через время
- Не использует [`Lavalink`](https://github.com/lavalink-devs/Lavalink) | [`Lavaplayer`](https://github.com/sedmelluq/lavaplayer) | [`YouTube-DL`](https://youtube-dl.org/)
- Поддерживает [`Opus`](https://wikipedia.org/wiki/Opus) но может работать и без
- Умеет кешировать треки и сохранять историю прослушиваний

## Настройки [`токена`](https://discord.com/developers/applications)
> [!TIP]
> Для нормально работы необходимо!

<img align="center" alt="PGI Settings" width="1516" src=".github/resource/PGI.png" />
<img align="center" alt="Bot Permissions" width="1390" src=".github/resource/Bot Permissions.png" />


## <img alt="Avatar" width="20px" src=".github/resource/Icons/Note.png" /> Гайд по запуску и настройке
> [!IMPORTANT]
> Если обнаружили ошибку или проект у вас не запускается вам [`сюда`](https://github.com/SNIPPIK/WatKLOK/issues)\
> Напоминаю что автор не несет никакой ответственности за та что вы будете делать с кодом

> [!CAUTION]
> Перед начало убедись что у вас установлена [`Node.js`](https://nodejs.org/ru/), [`FFmpeg`](https://ffmpeg.org)\
> Для работы музыки с VK требуется российский аккаунт и хост с российским IP

#### 1. Если не установлен [`FFmpeg`](https://github.com/BtbN/FFmpeg-Builds/releases)
   - `Windows` | Скачать [`FFmpeg`](https://github.com/BtbN/FFmpeg-Builds/releases)
     - Закинуть файл `ffmpeg.exe` в `C:\Windows` или `node_build/<env>.cached.dir`
     - В любое место, но это нужно будет указать в `<env>.ffmpeg.path`
   - `Linux` | (sudo apt install or sudo pacman -S) ffmpeg

#### 2. Собираем проект
 1. Устанавливаем все зависимости `npm i` 
 2. Устанавливаем typescript `npm i -g typescript`
 3. Конвертируем typescript в javascript `npm run build`

#### 3. Настраиваем [`env`](.env) файл
 1. Копируем .env в `node_build`
 2. Необходимо заполнить параметры `token` (необходим только `token.discord`)

#### 4. Запускаем бота

- Режим отладки `Debug mode`
    - Менеджер осколков -> `пока не поддерживается`
    - Без менеджера -> `npm run client:dev`
- Обычный запуск
    - Менеджер осколков -> `npm run shard`
    - Без менеджера -> `npm run client`
- Для удаления slash command
    - Запустить -> `npm run destroy`
    
# <img alt="Avatar" width="20px" src=".github/resource/Icons/Disk.gif" /> Библиотеки для конвертации аудио
> [!CAUTION]
> Хоть и данному проекту не требуется opus, он все-же опционален!\
> Обязательно требуется sodium!

- [`Opus Library`](src/libs/voice/audio/utils/Opus.ts) | Поддерживаемые библиотеки, опциональна!
    - [`opusscript`](https://www.npmjs.com/package/opusscript)
    - [`@discordjs/opus`](https://www.npmjs.com/package/@discordjs/opus)
    - [`mediaplex`](https://www.npmjs.com/package/mediaplex)
    - [`@evan/opus`](https://www.npmjs.com/package/@evan/opus)
- [`Sodium Library`](src/libs/voice/audio/utils/Sodium.ts) | Поддерживаемые библиотеки, необходима!
    - [`sodium-native`](https://www.npmjs.com/package/sodium-native) | Установлена по умолчанию
    - [`sodium`](https://www.npmjs.com/package/sodium)
    - [`libsodium-wrappers`](https://www.npmjs.com/package/libsodium-wrappers)
    - [`tweetnacl`](https://www.npmjs.com/package/tweetnacl)
