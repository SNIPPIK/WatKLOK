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


# <img alt="Avatar" width="20px" src="https://raw.githubusercontent.com/SNIPPIK/WatKLOK/nightly/.github/resource/Icons/Note.png" /> Гайд по запуску и настройке
Перед начало убедись что у вас установлена [`Node.js`](https://nodejs.org/ru/), [`FFmpeg`](https://ffmpeg.org)

#### 1. Если не установлен [`FFmpeg`](https://ffmpeg.org)
   - `Windows` | Скачать [`FFmpeg`](https://github.com/BtbN/FFmpeg-Builds/releases)
     - Установить в `C:\Windows` или в любое место, но это нужно будет указать в `.env`!
   - `Linux` | (sudo apt install or sudo pacman -S) ffmpeg

#### 2. Собираем проект
 1. Устанавливаем все зависимости `npm i` 
 2. Устанавливаем typescript `npm i -g typescript`
 3. Конвертируем typescript в javascript `npm run build`

#### 3. Настраиваем [`env`](.env) файл
 1. Копируем .env в `node_build`
 2. Необходимо заполнить параметры `token` (необходим только `token.discord`)

#### 4. Запускаем бота
 - Менеджер осколков -> `npm run shard`
 - Без менеджера -> `npm run client`

    
# <img alt="Avatar" width="20px" src="https://raw.githubusercontent.com/SNIPPIK/WatKLOK/nightly/.github/resource/Icons/Disk.gif" /> Библиотеки для конвертации аудио
- [`Opus Library`](src/Modules/voice/utils/Opus.ts) | Поддерживаемые библиотеки, опциональна!
    - [`opusscript`](https://www.npmjs.com/package/opusscript)
    - [`@discordjs/opus`](https://www.npmjs.com/package/@discordjs/opus)
    - [`mediaplex`](https://www.npmjs.com/package/mediaplex)
    - [`@evan/opus`](https://www.npmjs.com/package/@evan/opus)
- [`Sodium Library`](src/Modules/voice/utils/Sodium.ts) | Поддерживаемые библиотеки, необходима!
    - [`sodium-native`](https://www.npmjs.com/package/sodium-native) | Установлена по умолчанию
    - [`sodium`](https://www.npmjs.com/package/sodium)
