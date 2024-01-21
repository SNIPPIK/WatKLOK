[<img align="right" alt="Avatar" width="350px" src="https://media.discordapp.net/attachments/1066636694142595143/1155519865180930138/R_O_X_v2.1.png?width=619&height=619" />]()

# [`WatKLOK`](https://github.com/SNIPPIK/WatKLOK)
- Автор: [`SNIPPIK`](https://github.com/SNIPPIK)
- Бот не накладывает ограничений, это делают платформы!
### Описание
- Поддерживаться только /команды
- Возможно это лучший музыкальный бот?
- Умеет кешировать треки и сохранять историю прослушиваний
- Все сообщения удаляются через время
- Не используется [`Lavalink`](https://github.com/lavalink-devs/Lavalink) | [`Lavaplayer`](https://github.com/sedmelluq/lavaplayer) | [`YouTube-DL`](https://youtube-dl.org/)

<img align="center" alt="PGI Settings" width="1000px" src="https://github.com/SNIPPIK/WatKLOK/blob/main/.github/resource/PGI.png?raw=true" />
<img align="center" alt="Bot Permissions" width="1000px" src="https://github.com/SNIPPIK/WatKLOK/blob/main/.github/resource/Bot Permissions.png?raw=true" />


## <a name="run"></a> Как запустить
1. Качаем проект [`тут`](https://codeload.github.com/SNIPPIK/WatKLOK/zip/refs/heads/main)
2. Скачать и установить [`Node.js`](https://nodejs.org/ru/)
3. Выполнить npm i -g typescript
4. Установить [`FFmpeg и FFprobe`](https://github.com/BtbN/FFmpeg-Builds/releases)
   - В зависимости от платформы
      - `Windows` | Скачать [`FFmpeg`](https://ffmpeg.org/) и распаковать в любое место
         - Указать `ffmpeg.path` и `ffprobe.path` в [`env`](.env) 
      - `Linux` | (sudo apt install or sudo pacman -S) ffmpeg
5. Запуск бота
   - npm run build
   - npm run shard or npm run client