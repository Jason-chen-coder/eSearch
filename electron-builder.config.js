var arch = (process.env["npm_config_arch"] || process.env["M_ARCH"] || process.arch) == "arm64" ? ["arm64"] : ["x64"];
/**
 * @type import("electron-builder").Configuration
 */
let build = {
    appId: "com.esearch.app",
    directories: {
        output: "build",
    },
    compression: "maximum",
    icon: "./assets/logo",
    electronDownload: {
        mirror: "https://npmmirror.com/mirrors/electron/",
    },
    npmRebuild: false,
    fileAssociations: [
        {
            ext: "svg",
            mimeType: "image/svg+xml",
            role: "Editor",
        },
        {
            ext: "png",
            mimeType: "image/png",
            role: "Editor",
        },
        {
            ext: "jpg",
            mimeType: "image/jpeg",
            role: "Editor",
        },
    ],
    asar: false,
    artifactName: "${productName}-${version}-${platform}-" + arch[0] + ".${ext}",
    beforePack: "./before_pack.js",
    linux: {
        category: "Utility",
        target: ["tar.gz", "deb", "rpm", "AppImage"],
        files: [
            "!.vscode",
            "!.github",
            "!assets/logo/icon.icns",
            "!assets/logo/icon.ico",
            "!src",
            "!node_modules/onnxruntime-node/bin/napi-v3/win32",
            "!node_modules/onnxruntime-node/bin/napi-v3/darwin",
            "!node_modules/onnxruntime-web",
        ],
    },
    deb: {
        depends: ["ffmpeg"],
    },
    rpm: {
        depends: ["ffmpeg"],
    },
    mac: {
        files: [
            "!lib/gtk-open-with",
            "!lib/kde-open-with",
            "!.vscode",
            "!.github",
            "!assets/logo/1024x1024.png",
            "!assets/logo/512x512.png",
            "!assets/logo/icon.ico",
            "!src",
            "!node_modules/onnxruntime-node/bin/napi-v3/win32",
            "!node_modules/onnxruntime-node/bin/napi-v3/linux",
            "!node_modules/onnxruntime-web",
        ],
        target: [
            {
                target: "dmg",
                arch: arch,
            },
            {
                target: "zip",
                arch: arch,
            },
        ],
    },
    win: {
        icon: "./assets/logo/icon.ico",
        target: [
            {
                target: "nsis",
                arch: arch,
            },
            {
                target: "zip",
                arch: arch,
            },
        ],
        files: [
            "!lib/gtk-open-with",
            "!lib/kde-open-with",
            "!.vscode",
            "!.github",
            "!assets/logo/icon.icns",
            "!assets/logo/1024x1024.png",
            "!assets/logo/512x512.png",
            "!src",
            "!node_modules/onnxruntime-node/bin/napi-v3/linux",
            "!node_modules/onnxruntime-node/bin/napi-v3/darwin",
            "!node_modules/onnxruntime-web",
        ],
    },
    nsis: {
        oneClick: false,
        allowToChangeInstallationDirectory: true,
    },
};

module.exports = build;
