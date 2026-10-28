package io.runforyourlife.app;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().addJavascriptInterface(new AndroidBridge(this), "AndroidNative");
            bridge.getWebView().setWebChromeClient(new com.getcapacitor.BridgeWebChromeClient(bridge) {
                @Override
                public void onPermissionRequest(final android.webkit.PermissionRequest request) {
                    runOnUiThread(() -> {
                        request.grant(request.getResources());
                    });
                }
            });
        }

        // Proactively request Microphone permission for PTT Walkie-Talkie
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.MODIFY_AUDIO_SETTINGS
            }, 104);
        }
    }

    @Override
    public void onBackPressed() {
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().evaluateJavascript(
                "(function() { return window.handleAndroidBackButton ? window.handleAndroidBackButton() : false; })()",
                value -> {
                    if ("\"exit_app\"".equals(value) || "exit_app".equals(value)) {
                        finish();
                    } else if ("false".equals(value) || "null".equals(value)) {
                        super.onBackPressed();
                    }
                    // If true, the in-app confirmation modal or screen navigation handled the back press!
                }
            );
            return;
        }
        super.onBackPressed();
    }

    public static class AndroidBridge {
        private final MainActivity activity;

        public AndroidBridge(MainActivity activity) {
            this.activity = activity;
        }

        @JavascriptInterface
        public String checkPermissions() {
            try {
                JSONObject res = new JSONObject();

                // Location
                boolean locFine = ContextCompat.checkSelfPermission(activity, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
                boolean locCoarse = ContextCompat.checkSelfPermission(activity, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
                res.put("location", locFine || locCoarse);

                // Audio (Walkie-Talkie)
                boolean audio = ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
                res.put("audio", audio);

                // Camera
                boolean cam = ContextCompat.checkSelfPermission(activity, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
                res.put("camera", cam);

                // Bluetooth
                BluetoothAdapter btAdapter = BluetoothAdapter.getDefaultAdapter();
                boolean btEnabled = btAdapter != null && btAdapter.isEnabled();
                boolean btPerm = true;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    boolean scan = ContextCompat.checkSelfPermission(activity, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED;
                    boolean connect = ContextCompat.checkSelfPermission(activity, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
                    boolean adv = ContextCompat.checkSelfPermission(activity, Manifest.permission.BLUETOOTH_ADVERTISE) == PackageManager.PERMISSION_GRANTED;
                    btPerm = scan && connect && adv;
                } else {
                    boolean bt = ContextCompat.checkSelfPermission(activity, Manifest.permission.BLUETOOTH) == PackageManager.PERMISSION_GRANTED;
                    boolean btAdmin = ContextCompat.checkSelfPermission(activity, Manifest.permission.BLUETOOTH_ADMIN) == PackageManager.PERMISSION_GRANTED;
                    btPerm = bt && btAdmin;
                }
                res.put("bluetoothPermission", btPerm);
                res.put("bluetoothEnabled", btEnabled);
                res.put("bluetooth", btPerm && btEnabled);

                return res.toString();
            } catch (Exception e) {
                return "{\"error\":\"" + e.getMessage() + "\"}";
            }
        }

        @JavascriptInterface
        public void requestAudioPermission() {
            activity.runOnUiThread(() -> {
                ActivityCompat.requestPermissions(activity, new String[]{
                    Manifest.permission.RECORD_AUDIO,
                    Manifest.permission.MODIFY_AUDIO_SETTINGS
                }, 104);
            });
        }

        @JavascriptInterface
        public void requestLocationPermission() {
            activity.runOnUiThread(() -> {
                ActivityCompat.requestPermissions(activity, new String[]{
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION
                }, 101);
            });
        }

        @JavascriptInterface
        public void requestBluetoothPermission() {
            activity.runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    ActivityCompat.requestPermissions(activity, new String[]{
                        Manifest.permission.BLUETOOTH_SCAN,
                        Manifest.permission.BLUETOOTH_CONNECT,
                        Manifest.permission.BLUETOOTH_ADVERTISE
                    }, 103);
                } else {
                    BluetoothAdapter btAdapter = BluetoothAdapter.getDefaultAdapter();
                    if (btAdapter != null && !btAdapter.isEnabled()) {
                        Intent enableBtIntent = new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE);
                        activity.startActivity(enableBtIntent);
                    } else {
                        ActivityCompat.requestPermissions(activity, new String[]{
                            Manifest.permission.BLUETOOTH,
                            Manifest.permission.BLUETOOTH_ADMIN
                        }, 103);
                    }
                }
            });
        }

        @JavascriptInterface
        public void requestCameraPermission() {
            activity.runOnUiThread(() -> {
                ActivityCompat.requestPermissions(activity, new String[]{
                    Manifest.permission.CAMERA
                }, 102);
            });
        }

        @JavascriptInterface
        public void openAppSettings() {
            activity.runOnUiThread(() -> {
                try {
                    Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                    Uri uri = Uri.fromParts("package", activity.getPackageName(), null);
                    intent.setData(uri);
                    activity.startActivity(intent);
                } catch (Exception ignored) {}
            });
        }
    }
}
