[<img align="right" alt="Avatar" width="350px" src="https://media.discordapp.net/attachments/1066636694142595143/1155519865180930138/R_O_X_v2.1.png?width=619&height=619" />]()

# [`WatKLOK`](https://github.com/SNIPPIK/WatKLOK)
- Автор: [`SNIPPIK`](https://github.com/SNIPPIK)
- Бот не накладывает ограничений, это делают платформы!
### Описание
- Поддерживаться только /команды
- Возможно это лучший музыкальный бот?
- Умеет кешировать аудио, по принципу [`http, https`](src/Components/Request/index.ts)
- Умеет сохранять историю прослушиваний треков
- Все сообщения удаляются через время
- Не используется [`Lavalink`](https://github.com/lavalink-devs/Lavalink) | [`Lavaplayer`](https://github.com/sedmelluq/lavaplayer) | [`YouTube-DL`](https://youtube-dl.org/)

<img align="center" alt="PGI Settings" width="1000px" src="https://github.com/SNIPPIK/WatKLOK/blob/main/.github/resource/PGI.png?raw=true" />
<img align="center" alt="Bot Permissions" width="1000px" src="https://github.com/SNIPPIK/WatKLOK/blob/main/.github/resource/Bot Permissions.png?raw=true" />


## <a name="run"></a> Как запустить
1. Скачать и установить [`Node.js`](https://nodejs.org/ru/)
2. Установить [`FFmpeg и FFprobe`](https://github.com/BtbN/FFmpeg-Builds/releases)
   - В зависимости от платформы
      - `Windows` | Скачать [`FFmpeg`](https://ffmpeg.org/) и распаковать в любое место
      - `Linux` | sudo apt install ffmpeg
   - Указать `ffmpeg.path` и `ffprobe.path` в [`env`](.env)
3. Запуск бота
   - В зависимости от платформы
     - `Windows` | Запустить ROX.bat
     - `Other` | npm run build, потом npm run shard