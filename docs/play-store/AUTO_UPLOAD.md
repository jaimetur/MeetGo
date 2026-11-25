# Google Play: subir la app y las capturas

## 1. Subir a mano una versión nueva (lo de ahora)

1. En GitHub, abre **Releases → «Android app (rolling build)»** (la pre-release `android-latest`).
2. Descarga **`meetgo-android.aab`**. En **`android-build.txt`** ves de qué build y commit es: tiene que ser el último.
3. En [Play Console](https://play.google.com/console) → **MeetGo** → **Probar y publicar → Pruebas → Pruebas internas**.
4. **Crear nueva versión** → arrastra el `.aab` a «App bundles».
5. Nombre de la versión: se rellena solo (por ejemplo `0.2.57`). En «Notas de la versión» escribe qué cambia (por ejemplo «Notas de voz»).
6. **Siguiente → Guardar y publicar**. En unos minutos les llega a los testers internos (la app se actualiza sola o desde la ficha de Play).

Cada build nueva tiene un número de versión mayor (es el número de ejecución del workflow), así que Play siempre la acepta.

## 2. Que se suba sola en cada cambio (automático)

El workflow `.github/workflows/android.yml` ya tiene el paso preparado: en cuanto exista el secreto
`PLAY_SERVICE_ACCOUNT_JSON`, cada build nueva de Android se sube a **Pruebas internas** sin hacer nada más. Para
crearlo, una sola vez:

1. **Proyecto de Google Cloud.** En <https://console.cloud.google.com/> crea un proyecto (por ejemplo «MeetGo Play»)
   o usa el de Firebase.
2. **Activar la API.** En ese proyecto: **APIs y servicios → Biblioteca →** busca **«Google Play Android Developer
   API»** → **Habilitar**.
3. **Cuenta de servicio.** **IAM y administración → Cuentas de servicio → Crear cuenta de servicio**:
   nombre `github-play-upload`, sin roles → **Listo**.
4. **Clave JSON.** Entra en esa cuenta → pestaña **Claves → Agregar clave → Crear clave nueva → JSON**. Se descarga
   un archivo `.json`: es una contraseña, guárdalo bien y no lo subas a ningún repositorio.
5. **Darle permiso en Play.** En Play Console → **Usuarios y permisos → Invitar a usuarios nuevos**: pon el email de
   la cuenta de servicio (termina en `@….iam.gserviceaccount.com`). En **Permisos de la app** añade **MeetGo** y marca:
   «Ver información de la app», «Publicar en canales de prueba» (y «Gestionar la presencia en la tienda» si también
   quieres subir capturas con la API). **Invitar usuario**.
6. **Guardarla en GitHub.** En el repositorio → **Settings → Secrets and variables → Actions → New repository
   secret**: nombre `PLAY_SERVICE_ACCOUNT_JSON`, valor: **todo el contenido** del archivo `.json` → **Add secret**.
7. **Probar.** **Actions → Android app → Run workflow**. El paso «Upload to Google Play (internal testing)» debe
   salir en verde y la versión aparecer en Play Console → Pruebas internas.

Notas:
- La **primera** versión de una app siempre hay que subirla a mano (ya está hecha).
- Para **Producción** hace falta antes la prueba cerrada (12 testers durante 14 días, por ser cuenta personal). Cuando
  se pueda, basta con cambiar `track: internal` por `track: production` (o `beta`) en el workflow.
- Si Play responde que la app tiene cambios pendientes de revisión en la ficha, sube la versión a mano esa vez.

## 3. Capturas de la ficha en cada idioma

Play muestra a cada persona las capturas del idioma de su tienda si la ficha tiene ese idioma:

1. **Las capturas.** Están en `assets/play-store/<dispositivo>/<idioma>/` (`phone`, `tablet7`, `tablet10`,
   `chromebook`; `es`, `en`, `ca`, `de`, `fr`, `it`, `pt`, `nl`, `ja`, `zh`), numeradas en el orden en que van.
   Se regeneran con `tools/play_screenshots.py`, o en GitHub con **Actions → Play screenshots → Run workflow**
   (las vuelve a hacer y las guarda en la rama); con cada versión publicada se adjuntan además como
   `play-screenshots.zip` a su release.
2. **Los idiomas de la ficha.** Play Console → **Crecer → Presencia en Store → Ficha principal de Play Store →
   Gestionar traducciones → Añadir tus propias traducciones**: marca los idiomas (inglés de EE. UU., catalán, alemán,
   francés, italiano, portugués de Portugal, neerlandés, japonés y chino simplificado).
3. **En cada idioma** (selector de idioma arriba de la ficha): escribe la descripción traducida y sube en «Gráficos»
   las capturas de su carpeta: teléfono, tablet de 7", tablet de 10" y Chromebook.
4. **Guardar**. Los idiomas sin capturas propias usan las del idioma predeterminado (español).
