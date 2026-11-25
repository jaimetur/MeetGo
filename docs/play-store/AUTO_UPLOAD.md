# Google Play: subir la app y las capturas

## 1. Subir a mano una versión nueva (lo de ahora)

1. En GitHub, abre **Releases → «Android app (rolling build)»** (la pre-release `android-latest`).
2. Descarga **`meetgo-android.aab`**. En **`android-build.txt`** ves de qué build y commit es: tiene que ser el último.
3. En [Play Console](https://play.google.com/console) → **MeetGo** → **Probar y publicar → Pruebas → Prueba cerrada**
   → canal **Alpha** → **Gestionar canal**.
4. **Crear nueva versión** → arrastra el `.aab` a «App bundles».
5. Nombre de la versión: se rellena solo (por ejemplo `0.2.0 (57)`: la versión del repositorio y el número de build). En «Notas de la versión» escribe qué cambia (por ejemplo «Notas de voz»).
6. **Siguiente → Guardar y publicar**. Cuando Google la revisa, les llega a los testers de la prueba cerrada (la app se actualiza sola o desde la ficha de Play).

Play enseña la misma versión que el repositorio (`versionName` = la release `X.Y.Z`, la que pone
`tools/CreateUpdateRelease.py`) y un código de versión que crece en cada build (`versionCode` = número de ejecución
del workflow), así que Play siempre la acepta.

## 2. Que se suba sola en cada cambio (automático)

El workflow `.github/workflows/android.yml` ya tiene el paso preparado: en cuanto exista el secreto
`PLAY_SERVICE_ACCOUNT_JSON`, cada build nueva de Android de una rama `X.Y.Z` (también lanzada a mano; las de `main`
no) se sube sola a Play (`tools/play_publish.py`), al canal de la variable `PLAY_TRACK` (si no existe, `alpha` =
**prueba cerrada**), con el nombre «X.Y.Z (build)» y sus notas de versión (sección 4). Si la versión de Gradle no
coincide con la rama, la subida falla; sin el secreto, el workflow avisa y no sube nada. Cuando la versión llega a
`main`, se publica sola: release de GitHub y, con acceso a producción, Play (sección 4). Mam-IA, BodyLens y MeetGo
suben igual. Para crearlo, una sola vez:

1. **Cuenta de servicio: la que ya tienes para todas tus apps**, `play-billing@jtgcloud-play.iam.gserviceaccount.com`
   (proyecto de Google Cloud `jtgcloud-play`). No crees otra.
2. **Activar la API.** En <https://console.cloud.google.com/>, proyecto `jtgcloud-play`: **APIs y servicios →
   Biblioteca →** busca **«Google Play Android Developer API»** → **Habilitar** (si ya sale activada, nada).
3. **Clave JSON.** Usa la clave JSON de esa cuenta que ya tengas guardada. Si no la tienes: **IAM y administración →
   Cuentas de servicio → play-billing → Claves → Agregar clave → Crear clave nueva → JSON**. Es una contraseña:
   guárdala bien y no la subas a ningún repositorio.
4. **Darle permiso en Play.** En Play Console → **Gestionar cuenta → Usuarios y permisos → Invitar a nuevos usuarios**:
   pon el correo de la cuenta de servicio (`play-billing@jtgcloud-play.iam.gserviceaccount.com`), sin fecha de
   caducidad. En la pestaña **Permisos de la cuenta** (valen para todas las apps), marca «Ver información de las
   aplicaciones y descargar informes en bloque (solo lectura)», «Ver datos financieros, pedidos y respuestas a encuestas
   de cancelación», «Gestionar pedidos y suscripciones», «Lanzar aplicaciones en canales de pruebas», «Lanzar a
   producción, excluir dispositivos y usar la firma de aplicaciones de Play» y «Gestionar la presencia en Play Store».
   **Invitar usuario**. Si ya estaba invitada, ábrela con **Gestionar** en su fila y marca lo que le falte.
5. **Guardarla en GitHub.** En el repositorio → **Settings → Secrets and variables → Actions → New repository
   secret**: nombre `PLAY_SERVICE_ACCOUNT_JSON`, valor: **todo el contenido** del archivo `.json` → **Add secret**.
6. **El canal (opcional).** En el mismo sitio, pestaña **Variables → New repository variable**: nombre `PLAY_TRACK`,
   el canal de las ramas `X.Y.Z`, por defecto `alpha`: el canal que Play crea para la prueba cerrada («Alpha» en
   **Prueba cerrada**). Si tu prueba cerrada es un canal que creaste tú, pon aquí su nombre. El canal estable
   (`PLAY_STABLE_TRACK`) es otro: sección 4.
7. **Probar.** **Actions → Android app → Run workflow** en la rama de la versión. El paso «Upload to Google Play» debe
   salir en verde y la versión aparecer en ese canal de Play Console.

Notas:
- La **primera** versión de una app siempre hay que subirla a mano (ya está hecha).
- Para **Producción** hace falta antes la prueba cerrada (12 testers durante 14 días, por ser cuenta personal). Cuando
  se pueda, basta con crear la variable `PLAY_STABLE_TRACK` con `production` (sección 4).
- Si Play responde que la app tiene cambios pendientes de revisión en la ficha, sube la versión a mano esa vez.

## 3. La ficha en cada idioma: textos y capturas

Play enseña a cada persona la ficha en el idioma de su tienda. La ficha de MeetGo tiene los 10 idiomas de la app y se
actualiza sola, sin pasar por Play Console:

1. **Los textos.** Están en `assets/play-store/listings/<idioma>.json` (`es-ES`, `en-US`, `ca`, `de-DE`, `fr-FR`,
   `it-IT`, `pt-PT`, `nl-NL`, `ja-JP`, `zh-CN`): `title` (30 caracteres como máximo), `shortDescription` (80) y
   `fullDescription` (4000). Para cambiar la ficha, se cambian ahí.
2. **Las capturas.** Están en `assets/play-store/<dispositivo>/<idioma>/` (`phone`, `tablet7`, `tablet10`,
   `chromebook`; `es`, `en`, `ca`, `de`, `fr`, `it`, `pt`, `nl`, `ja`, `zh`), numeradas en el orden en que van.
   Se regeneran solas en GitHub en cada push a `main` o a una rama `X.Y.Z` que cambie la web, el contenido de
   demostración, las traducciones o los textos de la ficha (también a mano con **Actions → Play screenshots → Run
   workflow**), y se guardan en la misma rama; con cada versión publicada se adjuntan además como
   `play-screenshots.zip` a su release.
3. **La subida.** Después, con el secreto `PLAY_SERVICE_ACCOUNT_JSON`, `tools/play_listing.py` crea o actualiza cada
   idioma de la ficha con sus textos, sus capturas de teléfono y de tablet de 7" y 10", y el gráfico de funciones
   (`docs/play-store/feature-1024x500-es.png` para español, el de `-en` para el resto). Lo ves en el paso «Send them to
   the Play listing» del workflow.
4. **A mano solo queda** lo que la API no admite: las capturas de Chromebook (Play Console → Ficha principal →
   selector de idioma → «Gráficos» → Chromebook, con las de `assets/play-store/chromebook/<idioma>/`).

Para ver qué se mandaría sin conectar: `python tools/play_listing.py --dry-run`.

## 4. Release final, notas de versión y producción

Cuando una versión llega a `main` (al fusionar su rama `X.Y.Z`), «🚀 Release» (`.github/workflows/release.yml`) la
publica sola:

- **GitHub**: la release `vX.Y.Z`, marcada como la última, con las notas del bloque de esa versión en `CHANGELOG.md`, el
  código fuente, las capturas de Play (`play-screenshots.zip`) y el APK y el AAB de la app. Si la versión ya tenía
  release, se vuelve a publicar en el commit nuevo.
- **Google Play**: la compilación de esa versión que los testers tienen en la prueba cerrada pasa al canal estable de
  la variable `PLAY_STABLE_TRACK` (`production`), con sus notas. Es la misma compilación que probaron: no se vuelve a
  compilar. Si la prueba cerrada no tiene esa versión, falla y lo dice: lanza antes el workflow de Android en la rama.
  Mientras `PLAY_STABLE_TRACK` no existe, la release de GitHub se publica igual y la versión se queda en la prueba
  cerrada.

**Notas de versión.** Salen del bloque de la versión en `CHANGELOG.md`, para GitHub y para Play («Novedades», en cada
subida a la prueba cerrada y al pasar a producción):

- GitHub recibe el bloque entero.
- Play admite como mucho 500 caracteres por idioma. Si el bloque tiene secciones `#### 📱 Google Play (<idioma>):`, una
  por idioma, se manda su texto tal cual. Si no, se mandan los títulos de sus novedades, mejoras y correcciones, en
  inglés (el idioma del CHANGELOG). Solo van los idiomas que tiene la ficha, y la sección 3 los crea todos. Las
  secciones 📱 no salen en GitHub.

```markdown
#### 📱 Google Play (es-ES):
Comunidades con su afición, notas de voz y la app en diez idiomas.

#### 📱 Google Play (en-US):
Communities with their hobby, voice notes and the app in ten languages.
```

Para ver lo que recibiría Play: `python tools/play_publish.py notes 0.2.0`.

**Pasar a producción (una vez).** Con una cuenta de desarrollador personal, Google pide antes una prueba cerrada con al
menos 12 testers durante 14 días seguidos. Después, en Play Console → **Panel → Solicitar acceso a producción**. Cuando
Google lo conceda:

1. La cuenta de servicio necesita «Lanzar a producción, excluir dispositivos y usar la firma de aplicaciones de Play».
   Si la invitaste como en la sección 2, ya lo tiene. Si no: **Gestionar cuenta → Usuarios y permisos →
   Gestionar** en su fila, y márcalo.
2. **Play Console → Probar y publicar → Producción → pestaña Países o territorios → Añadir países o territorios**:
   añade los países donde se publica y guarda los cambios. Sin países, la subida a producción falla.
3. Activa el canal estable (en el terminal, desde cualquier carpeta):

   ```bash
   gh variable set PLAY_STABLE_TRACK --body production -R jaimetur/MeetGo
   ```

   Las 3 apps (Mam-IA, BodyLens y MeetGo) a la vez:

   ```bash
   for r in Mam-IA BodyLens MeetGo; do gh variable set PLAY_STABLE_TRACK --body production -R jaimetur/$r; done
   ```

4. Prueba: **Actions → 🚀 Release → Run workflow**, rama `main`. El registro debe terminar con
   «X.Y.Z sent to the production track».

Desde entonces, las ramas `X.Y.Z` siguen subiendo a la prueba cerrada y lo que llega a `main` va a producción, para
todos los usuarios en cuanto Google lo aprueba. No hay despliegue progresivo (porcentaje de usuarios): con pocos
usuarios no aporta nada, y habría que subir el porcentaje a mano en Play Console.
