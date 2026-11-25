# Google Play: subir la app y las capturas

## 1. Subir a mano una versión nueva (lo de ahora)

1. En GitHub, abre **Releases → «Android app (rolling build)»** (la pre-release `android-latest`).
2. Descarga **`meetgo-android.aab`**. En **`android-build.txt`** ves de qué build y commit es: tiene que ser el último.
3. En [Play Console](https://play.google.com/console) → **MeetGo** → **Probar y publicar → Pruebas → Pruebas cerradas**
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
4. **Darle permiso en Play.** En Play Console → **Gestionar cuenta → Usuarios y permisos → Invitar a usuarios
   nuevos**: pon el email de la cuenta de servicio (`play-billing@jtgcloud-play.iam.gserviceaccount.com`; si ya está
   invitada, ábrela). En **Permisos de la app** añade **MeetGo** y marca:
   «Ver información de la app», «Publicar en canales de prueba», «Publicar en producción…» (solo si vas a usar
   `production`) y «Gestionar la presencia en la tienda» (para que suba las capturas). **Invitar usuario**.
5. **Guardarla en GitHub.** En el repositorio → **Settings → Secrets and variables → Actions → New repository
   secret**: nombre `PLAY_SERVICE_ACCOUNT_JSON`, valor: **todo el contenido** del archivo `.json` → **Add secret**.
6. **El canal (opcional).** En el mismo sitio, pestaña **Variables → New repository variable**: nombre `PLAY_TRACK`,
   el canal de las ramas `X.Y.Z`, por defecto `alpha`: el canal que Play crea para la prueba cerrada («Alpha» en
   **Pruebas cerradas**). Si tu prueba cerrada es un canal que creaste tú, pon aquí su nombre. El canal estable
   (`PLAY_STABLE_TRACK`) es otro: sección 4.
7. **Probar.** **Actions → Android app → Run workflow** en la rama de la versión. El paso «Upload to Google Play» debe
   salir en verde y la versión aparecer en ese canal de Play Console.

Notas:
- La **primera** versión de una app siempre hay que subirla a mano (ya está hecha).
- Para **Producción** hace falta antes la prueba cerrada (12 testers durante 14 días, por ser cuenta personal). Cuando
  se pueda, basta con crear la variable `PLAY_STABLE_TRACK` con `production` (sección 4).
- Si Play responde que la app tiene cambios pendientes de revisión en la ficha, sube la versión a mano esa vez.

## 3. Capturas de la ficha en cada idioma

Play muestra a cada persona las capturas del idioma de su tienda si la ficha tiene ese idioma:

1. **Las capturas.** Están en `assets/play-store/<dispositivo>/<idioma>/` (`phone`, `tablet7`, `tablet10`,
   `chromebook`; `es`, `en`, `ca`, `de`, `fr`, `it`, `pt`, `nl`, `ja`, `zh`), numeradas en el orden en que van.
   Se regeneran solas en GitHub en cada push a `main` o a una rama `X.Y.Z` que cambie la web, el contenido de
   demostración o las traducciones (también a mano con **Actions → Play screenshots → Run workflow**), y se guardan
   en la misma rama; con cada versión publicada se adjuntan además como `play-screenshots.zip` a su release.
   Si existe el secreto `PLAY_SERVICE_ACCOUNT_JSON`, `tools/play_listing.py` las sube además a la ficha de Play en
   cada idioma que ya tenga traducción (teléfono y tablets; las de Chromebook no tienen hueco en la API: a mano).
2. **Los idiomas de la ficha.** Play Console → **Crecer → Presencia en Store → Ficha principal de Play Store →
   Gestionar traducciones → Añadir tus propias traducciones**: marca los idiomas (inglés de EE. UU., catalán, alemán,
   francés, italiano, portugués de Portugal, neerlandés, japonés y chino simplificado).
3. **En cada idioma** (selector de idioma arriba de la ficha): escribe la descripción traducida y sube en «Gráficos»
   las capturas de su carpeta: teléfono, tablet de 7", tablet de 10" y Chromebook.
4. **Guardar**. Los idiomas sin capturas propias usan las del idioma predeterminado (español).

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
  inglés (el idioma del CHANGELOG). Solo van los idiomas que tiene la ficha, así que sin la traducción `en-US` de la
  ficha (sección 3) las notas automáticas no llegan. Las secciones 📱 no salen en GitHub.

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

1. **Play Console → Gestionar cuenta → Usuarios y permisos**: abre la cuenta de servicio. En **Permisos de la app →
   MeetGo**, añade «Publicar en producción, excluir dispositivos y usar la firma de aplicaciones de Play».
   **Aplicar → Guardar cambios.**
2. **Play Console → Probar y publicar → Producción → pestaña Países/regiones**: añade los países donde se publica. Sin
   países, la subida a producción falla.
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
