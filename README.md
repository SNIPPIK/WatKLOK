[<img align="right" alt="Avatar bot" width="350px" src="https://media.discordapp.net/attachments/1016995045783633940/1080964769927942234/Icon.png" />](https://discordapp.com/users/623170593268957214)
# WatKLOK
- Автор: [`SNIPPIK`](https://github.com/SNIPPIK)
- Лицензия: [`MIT`](LICENSE.md)
- Перейти к [`настройкам`](db/Config.json)
- Перейти к [`командам`](data/Commands) | `Slash + Standart`
- Перейти к [`плееру`](resource/Modules/AudioPlayer)
- Перейти к [`демонстрации`](https://www.youtube.com/playlist?list=PLrQkedRE9MFvchEkGvt-Tk5jqS5GiS8Kd)
- Все сообщения удаляются автоматически через время

<img align="center" alt="PGI Settings" width="1000px" src="https://github.com/SNIPPIK/WatKLOK/blob/v2/.github/resource/PGI.png?raw=true" />

<img align="center" alt="Bot Permissions" width="1000px" src="https://github.com/SNIPPIK/WatKLOK/blob/v2/.github/resource/Bot Permissions.png?raw=true" />

## Гайд по запуску
1. [`Node.js`](https://nodejs.org/ru/) 20
2. [`FFmpeg & FFprobe`](https://ffmpeg.org/) или npm install (ffmpeg-static и ffprobe-static)
3. Запускаем `npm run build`
4. Указываем данные в [`build/.env`](build/.env) | `Ps если его нет, то надо создать`
5. Варианты запуска | `Если возникли ошибки повторите шаги заново`
   - Если серверов не более 1к, то `npm run start`
   - Если серверов более 1к, то `npm run shard`

## Поддерживаемые платформы
[Можно добавить поддержку иных платформ](data/APIs)

| Платформы                                    | Аудио      | Что доступно                                 | Доступ без авторизации |
|----------------------------------------------|------------|----------------------------------------------|------------------------|
| [**YouTube**](https://www.youtube.com/)      | ✔          | **видео, плейлисты, поиск, стримы, каналы**  | ✔                      |
| [**Spotify**](https://open.spotify.com/)     | ✔ (YM, YT) | **треки, плейлисты, поиск, альбомы, авторы** | ❌                      |
| [**Yandex Music**](https://music.yandex.ru/) | ✔          | **треки, альбомы, поиск, авторы**            | ❌                      |
| [**SoundCloud**](https://soundcloud.com/)    | ✔          | **треки, плейлисты, поиск, альбомы**         | ✔                      |
| [**VK**](https://vk.com/)                    | ✔          | **треки, ~~плейлисты~~, поиск**              | ❌                      |
| [**Discord**](https://discord.com/)          | ✔          | **ссылки, файлы**                            | ✔                      |

<details>
  <summary>Показать настройки</summary>

### Настройки
1. [.env](.env) | Копировать в [build](./build)
2. [`Filters.json`](data/Json/Filters.json) | Можно добавлять свои фильтры в конфиг | [`FFmpeg Docs`](https://ffmpeg.org/ffmpeg.html)
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
         //Влияет на progress bar
         "speed": "arg"
      }
   ]
     ```
</details>