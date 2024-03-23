<center><img src="https://raw.githubusercontent.com/SNIPPIK/WatKLOK/nightly/.github/resource/Icons/BG.png" alt="centered image" height="50"></center>


[<img align="right" alt="Avatar" width="350px" src="https://raw.githubusercontent.com/SNIPPIK/WatKLOK/nightly/.github/resource/Icons/Bot.png" />]()

# [`WatKLOK`](https://github.com/SNIPPIK/WatKLOK) 
- Автор: [`SNIPPIK`](https://github.com/SNIPPIK)
- Доступные платформы: [`тут`](src/handlers/APIs)
- Демонстрация: [`тут`](https://www.youtube.com/watch?v=G7vgPmnt9_8)
- Поддерживаться только /команды
- Все сообщения удаляются через время
- Умеет кешировать треки и сохранять историю прослушиваний
- Не использует [`Lavalink`](https://github.com/lavalink-devs/Lavalink) | [`Lavaplayer`](https://github.com/sedmelluq/lavaplayer) | [`YouTube-DL`](https://youtube-dl.org/)
- Поддерживает [`Opus`](https://wikipedia.org/wiki/Opus) но может работать и без


## Настройки [`токена`](https://discord.com/developers/applications)

<img align="center" alt="PGI Settings" width="1000px" src="https://github.com/SNIPPIK/WatKLOK/blob/nightly/.github/resource/PGI.png?raw=true" />
<img align="center" alt="Bot Permissions" width="1000px" src="https://github.com/SNIPPIK/WatKLOK/blob/nightly/.github/resource/Bot Permissions.png?raw=true" />


## <img alt="Avatar" width="20px" src="https://raw.githubusercontent.com/SNIPPIK/WatKLOK/nightly/.github/resource/Icons/Note.png" /> Как запустить
1. Необходима [`Node.js`](https://nodejs.org/ru/)
2. Качаем проект [`тут`](https://codeload.github.com/SNIPPIK/WatKLOK/zip/refs/heads/main)
3. Установить [`FFmpeg`](https://github.com/BtbN/FFmpeg-Builds/releases)
   - `Windows` | Скачать [`FFmpeg`](https://ffmpeg.org/) и распаковать в любое место
     - Указать `ffmpeg.path` в [`env`](.env)
   - `Linux` | (sudo apt install or sudo pacman -S) ffmpeg
4. [`Настраиваем конфиг`](#Как-настроить-env-файл) .env
5. Открываем консоль или терминал в директории проекта
   - Устанавливаем все зависимости `npm i`
   - Выполняем сборку `npm i -g typescript`
   - Настраиваем конфиг .env в директории `node_build`
   - Запускаем бота
     - Менеджер осколков -> `npm run shard`
     - Без менеджера -> `npm run client`

    
## <img alt="Avatar" width="20px" src="https://raw.githubusercontent.com/SNIPPIK/WatKLOK/nightly/.github/resource/Icons/Disk.gif" /> Библиотеки для конвертации аудио
- [`Opus Library`](src/Modules/voice/utils/Opus.ts) | Поддерживаемые библиотеки, опциональна!
    - [`opusscript`](https://www.npmjs.com/package/opusscript)
    - [`@discordjs/opus`](https://www.npmjs.com/package/@discordjs/opus)
    - [`mediaplex`](https://www.npmjs.com/package/mediaplex)
    - [`@evan/opus`](https://www.npmjs.com/package/@evan/opus)
- [`Sodium Library`](src/Modules/voice/utils/Sodium.ts) | Поддерживаемые библиотеки, необходима!
    - [`sodium-native`](https://www.npmjs.com/package/sodium-native)
    - [`sodium`](https://www.npmjs.com/package/sodium)



## Как настроить [`env`](.env) файл
1. Необходимо заполнить параметры `token` (необходим только `token.discord`)
2. Заполнить параметры `progress`, `button`, `loading`
3. Остальные параметры по желанию
