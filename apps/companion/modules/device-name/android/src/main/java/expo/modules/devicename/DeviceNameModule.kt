package expo.modules.devicename

import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The name the owner gave this phone ("Galaxy M52 5G"), which is what the
 * desktop should call it. `Build.MODEL`, which expo-constants reports as
 * the device name on Android, is the model number ("SM-M526B").
 */
class DeviceNameModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DeviceName")

    Function("get") {
      val resolver = appContext.reactContext?.contentResolver ?: return@Function null
      Settings.Global.getString(resolver, Settings.Global.DEVICE_NAME)?.takeIf { it.isNotBlank() }
        ?: Settings.Secure.getString(resolver, "bluetooth_name")?.takeIf { it.isNotBlank() }
    }
  }
}
