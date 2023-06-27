[<img align="right" alt="Avatar bot" width="350px" src="https://media.discordapp.net/attachments/1016995045783633940/1080964769927942234/Icon.png" />](https://discordapp.com/users/623170593268957214)
# WatKLOK 
- Автор: [`SNIPPIK`](https://github.com/SNIPPIK)
- Лицензия: [`MIT`](LICENSE.md)
- Перейти к [`настройкам`](.env.dev)
- Перейти к [`командам`](src/Data/Commands)
- Перейти к [`демонстрации`](https://www.youtube.com/playlist?list=PLrQkedRE9MFvchEkGvt-Tk5jqS5GiS8Kd)


### Описание
 - Это просто музыкальный бот, работающий на `ffmpeg`
 - Умеет кешировать аудио, по принципу [`http, https`](src/Components/Request/index.ts)
 - Все сообщения удаляются через время
 - Никаких [`Lavalink`](https://github.com/lavalink-devs/Lavalink)

<img align="center" alt="PGI Settings" width="1000px" src="https://github.com/SNIPPIK/WatKLOK/blob/v2/.github/resource/PGI.png?raw=true" />
<img align="center" alt="Bot Permissions" width="1000px" src="https://github.com/SNIPPIK/WatKLOK/blob/v2/.github/resource/Bot Permissions.png?raw=true" />


## <a name="run"></a> Как запустить
1. Скачать и установить [`Node.js`](https://nodejs.org/ru/)
2. Установить FFmpeg и FFprobe
   - В зависимости от платформы
      - `Windows` | Скачать [`FFmpeg`](https://ffmpeg.org/) и распаковать в любое место
      - `Linux` | sudo apt install ffmpeg
   - Указать `ffmpeg.name` и `ffprobe.name` в [`env`](.env.dev)
3. Открыть консоль в текущей директории и выполнить `npm run build`
    - При возникновении ошибки выполнить `npm install -g typescript` и повторить 3 шаг
4. Открыть только что созданную [`папку`](.AutoBuild)
5. Если нет .env файла, то надо создать [`файл`](.env.dev)
6. Варианты запуска
   - Если серверов не более 1к, то `npm run start`
   - Если серверов более 1к, то `npm run shard`




## <a name="APIS"></a> [`APIs`](src/Data/APIs)
- Является директорией с запросами
- Можно добавить свою поддержку любой платформы используя примеры
- Для загрузки необходимо добавить в [APIs](src/Components/APIs/index.ts)





## <a name="AudioPlayer"></a> [`AudioPlayer`](src/Components/AudioPlayer)
  - Является частичным fork'ом [discordjs/voice](https://www.npmjs.com/package/@discordjs/voice)
  - Музыка работает через `FFmpeg` конвертируется в `opus`
  - Используется [`SodiumLib`](#sodium-libs)
  - Присутствует поддержка фильтров через `FFmpeg`, добавляются в [`Filters`](src/Data/Json/Filters.json)


    

## <a name="sodium-libs"></a> [`Sodium libs`](https://discordjs.guide/voice/#extra-dependencies)
 - Необходим для шифровки голосовых пакетов
 - Рекомендуемые библиотеки
   - [sodium](https://www.npmjs.com/package/sodium) (Best)
   - [sodium-native](https://www.npmjs.com/package/sodium-native)