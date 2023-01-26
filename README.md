[<img align="right" alt="Avatar bot" width="350px" src="https://media.discordapp.net/attachments/1016995045783633940/1066418989061910558/Icon_NG.png" />](https://discordapp.com/users/623170593268957214)
# WatKLOK
- Автор: [`SNIPPIK`](https://github.com/SNIPPIK)
- Лицензия: [`WatKLOK LICENSE`](LICENSE.md)
- Перейти к [`настройкам`](db/Config.json)
- Перейти к [`командам`](src/Handler/Commands) | `Slash + Standart`
- Перейти к [`плееру`](src/AudioPlayer)
- Перейди к [`демонстрации`](https://www.youtube.com/watch?v=ncvpyWaxycw)
- Все сообщения удаляются автоматически через время

[<img align="center" alt="PGI Settings" width="1000px" src="https://github.com/SNIPPIK/WatKLOK/blob/v2/.github/resource/PGI.png?raw=true" />](https://github.com/SNIPPIK/WatKLOK/blob/v2/.github/resource/PGI.png?raw=true)

## Гайд по запуску
1. [`Node.js`](https://nodejs.org/ru/) 18-19
2. [`FFmpeg & FFprobe`](https://ffmpeg.org/) или npm install (ffmpeg-static и ffprobe-static)
3. Указываем данные в [`build/.env`](build/.env) | `Ps если его нет, то надо создать`
4. Варианты запуска | `Если возникли ошибки повторите шаги заново`
   - Если серверов не более 1к, то `npm run start`
   - Если серверов более 1к, то `npm run sharder`

## Поддерживаемые платформы
[Можно добавить поддержку иных платформ](src/AudioPlayer/Structures/SongSupport.ts)

| Платформы                                    | Что доступно                                 | Аудио       |
|----------------------------------------------|----------------------------------------------|-------------|
| [**YouTube**](https://www.youtube.com/)      | **видео, плейлисты, поиск, стримы, каналы**  | ✔           |
| [**Spotify**](https://open.spotify.com/)     | **треки, плейлисты, поиск, альбомы, авторы** | ✖ (YouTube) |
| [**Yandex Music**](https://music.yandex.ru/) | **треки, альбомы, поиск, авторы**            | ✖ (YouTube) |
| [**VK**](https://vk.com/)                    | **треки, ~~плейлисты~~, поиск**              | ✔           |
| [**SoundCloud**](https://soundcloud.com/)    | **треки, плейлисты, поиск, альбомы**         | ✔           |
| [**Discord**](https://discord.com/)          | **ссылки, файлы**                            | ✔           |

## Настройки
1. [`.env`](.env) | для не публичных данных
   ```dotenv
    TOKEN="" #Discord bot token
    SPOTIFY_ID="" #Spotify client id
    SPOTIFY_SECRET="" #Spotify client secket
    SOUNDCLOUD="" #Soundcloud client id
    VK_TOKEN="" #Vk auth token (user token, not a bot token)
   ```
1. [`Cookie.json`](db/Cookie.json) | необходим для видео 18+ (**YouTube**)
    ```json5
   {
      "Cookie": ""
   }
   ```
2. [`Config.json`](db/Config.json) | основные настройки
   ```json5
   {
      "APIs": {
        "showErrors": false, //Отображать ошибки запросов платформ (ошибки будут видны только в консоли)
        "sendErrors": false //Отправлять сообщения об ошибках (ошибки будут видны в канале если он указан Channels.sendErrors)
      },
      "Channels": {
        "sendErrors": "", //ID канала на который будут отображаться ошибки
        "removeUser": ""  //ID канала на котором будут отображаться пользователи покинувшие сервер
      },
      "Bot": {
         "ignoreErrors": true, //Игнорировать ошибки
         "prefix": "!", //Префикс
         "OwnerIDs": [], //Пользователи у которых есть доступ к разделу Owner

         //Бот будет делать вид, что пишет в текстовый канал
         "TypingMessage": true
      },
      "Debug": false, //Отправлять сообщение взаимодействий бота с discord

      //Настройки музыки
      "Music": {
         "CacheMusic": false, //Кешировать музыку? (Значительно ускоряет работу фильтров и seek, как уменьшает кол-во запросов на сервера)
         "CacheDir": "AudioCache", //Путь, где будет сохраниться кеш музыки

         //Настройки плеера
         "AudioPlayer": {
            "sendDuration": 20 //Задержка до начала отправления пакетов
         },
          //Прогресс бар текущего трека
         "ProgressBar": {
            "enable": true, //Состояние (отображать или не отображать)
            "empty": "─", //После точки будет идти empty
            "full": "─", //До точки будет идти full
            "button": "⚪" //Сама точка
         },
         //Настройки аудио
         "Audio": {
             "bitrate": "256k", //Битрейт аудио
             "transition": true //Более плавный переход от одного потока к другому
         }
      },

      //Настройка меню
      "ReactionMenuSettings": {
         "emojis": {
            "back": "⬅️", //Кнопка назад
            "next": "➡️", //Кнопка вперед
            "cancel": "❌" //Удаление меню
         }
      }
   }
   ```
3. [`Filters.json`](db/Filters.json) | Можно добавлять свои фильтры в конфиг | [`FFmpeg Docs`](https://ffmpeg.org/ffmpeg.html)
    ```json5
   [
      {
         "names": ["name"], //Названия
         "description": "Типа описание", //Описание

         //Сам аргумент, если указывать args то необходимо что-бы в конце аргумента было =
         //Пример atempo=
         "filter": "Аргумент для FFmpeg",

         //Мин, макс - мин и макс аргументы для фильтра
         //Если аргумент не нужен, оставить false
         "args": [1, 3],

         //Ускоряется ли музыка, да то как (arg - ускоряется аргументом, 1.25 - ускоряется в 1.25)
         "speed": "arg"
      }
   ]
     ```