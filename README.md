[<img align="right" alt="Avatar" width="350px" src="https://media.discordapp.net/attachments/1066636694142595143/1155519865180930138/R_O_X_v2.1.png?width=619&height=619" />]()

# [`WatKLOK`](https://github.com/SNIPPIK/WatKLOK) 
- Автор: [`SNIPPIK`](https://github.com/SNIPPIK)
- Доступные платформы: [`тут`](src/Handlers/APIs)
- Демонстрация: [`тут`](https://www.youtube.com/watch?v=G7vgPmnt9_8)
- Поддерживаться только /команды
- Все сообщения удаляются через время
- Умеет кешировать треки и сохранять историю прослушиваний
- Не использует [`Lavalink`](https://github.com/lavalink-devs/Lavalink) | [`Lavaplayer`](https://github.com/sedmelluq/lavaplayer) | [`YouTube-DL`](https://youtube-dl.org/)
- Поддерживает [`Opus`](https://wikipedia.org/wiki/Opus) но может работать и без


## Настройки [`токена`](https://discord.com/developers/applications)

<img align="center" alt="PGI Settings" width="1000px" src="https://github.com/SNIPPIK/WatKLOK/blob/main/.github/resource/PGI.png?raw=true" />
<img align="center" alt="Bot Permissions" width="1000px" src="https://github.com/SNIPPIK/WatKLOK/blob/main/.github/resource/Bot Permissions.png?raw=true" />

## Зависимости
- [`Opus Library`](src/Modules/voice/utils/Opus.ts) | Поддерживаемые библиотеки, опциональна!
  - [`opusscript`](https://www.npmjs.com/package/opusscript)
  - [`@discordjs/opus`](https://www.npmjs.com/package/@discordjs/opus)
  - [`mediaplex`](https://www.npmjs.com/package/mediaplex)
  - [`@evan/opus`](https://www.npmjs.com/package/@evan/opus)
- [`Sodium Library`](src/Modules/voice/utils/Sodium.ts) | Поддерживаемые библиотеки, необходима!
  - [`sodium-native`](https://www.npmjs.com/package/sodium-native)
  - [`sodium`](https://www.npmjs.com/package/sodium)

## Как запустить
1. Необходима [`Node.js`](https://nodejs.org/ru/)
2. Качаем проект [`тут`](https://codeload.github.com/SNIPPIK/WatKLOK/zip/refs/heads/main)
3. Установить [`FFmpeg и FFprobe`](https://github.com/BtbN/FFmpeg-Builds/releases)
   - `Windows` | Скачать [`FFmpeg`](https://ffmpeg.org/) и распаковать в любое место
     - Указать `ffmpeg.path` и `ffprobe.path` в [`env`](.env)
   - `Linux` | (sudo apt install or sudo pacman -S) ffmpeg
4. Настраиваем конфиг .env
5. Открываем консоль или терминал в директории проекта
   - Устанавливаем все зависимости `npm i`
   - Выполняем сборку `npm i -g typescript`
   - Настраиваем конфиг .env в директории `node_build`
   - Запускаем бота
     - Менеджер осколков -> `npm run shard`
     - Без менеджера -> `npm run client`
