/// <reference types="vite/client" />
// Modules to control application life and create native browser window
import {
    app,
    Tray,
    Menu,
    clipboard,
    globalShortcut,
    BrowserWindow,
    ipcMain,
    dialog,
    Notification,
    shell,
    nativeImage,
    nativeTheme,
    BrowserView,
    screen,
    desktopCapturer,
    session,
} from "electron";
import { Buffer } from "buffer";
type Screenshots = {
    id: number;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    scaleFactor: number;
    isPrimary: boolean;
    all(): Array<Screenshots> | null;
    fromDisplay(id: number): Screenshots | null;
    fromPoint(x: number, y: number): Screenshots | null;
    captureSync(): Buffer | null;
    capture(): Promise<Buffer>;
    captureAreaSync(x: number, y: number, width: number, height: number): Buffer | null;
    captureArea(x: number, y: number, width: number, height: number): Promise<Buffer>;
};
const { Screenshots } = require("node-screenshots") as { Screenshots: Screenshots };
const Store = require("electron-store");
import * as path from "path";
const run_path = path.join(path.resolve(__dirname, ""), "../../");
import { exec } from "child_process";
import * as fs from "fs";
import * as os from "os";
import { t, lan } from "../../lib/translate/translate";
import time_format from "../../lib/time_format";

// 自定义用户路径
try {
    var userDataPath = fs.readFileSync(path.join(run_path, "preload_config")).toString().trim();
    if (userDataPath) {
        if (app.isPackaged) {
            userDataPath = path.join(run_path, "../../", userDataPath);
        } else {
            userDataPath = path.join(run_path, userDataPath);
        }
        app.setPath("userData", userDataPath);
    }
} catch (e) {}

// 其他应用打开
if (process.platform == "linux")
    ipcMain.on("run_path", (event) => {
        event.returnValue = run_path;
    });

// 重写存储获取用户路径的方式
ipcMain.on("electron-store-get-data", (event) => {
    event.returnValue = {
        defaultCwd: app.getPath("userData"),
        appVersion: app.getVersion(),
    };
});

var store = new Store();

var /** 是否开启开发模式 */ dev: boolean;
// 自动开启开发者模式
if (process.argv.includes("-d") || import.meta.env.DEV) {
    dev = true;
} else {
    dev = false;
}

/** 加载网页 */
function renderer_path(window: BrowserWindow | Electron.WebContents, file_name: string, q?: Electron.LoadFileOptions) {
    if (!app.isPackaged && process.env["ELECTRON_RENDERER_URL"]) {
        window.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/${file_name}`);
    } else {
        window.loadFile(path.join(__dirname, "../renderer", file_name), q);
    }
}

if (!store.get("硬件加速")) {
    app.disableHardwareAcceleration();
}

// 自启动
ipcMain.on("autostart", (event, m, v) => {
    if (m == "set") {
        if (process.platform == "linux") {
            if (v) {
                exec("mkdir ~/.config/autostart");
                exec(`cp ${run_path}/assets/e-search.desktop ~/.config/autostart/`);
            } else {
                exec("rm ~/.config/autostart/e-search.desktop");
            }
        } else {
            app.setLoginItemSettings({ openAtLogin: v });
        }
    } else {
        if (process.platform == "linux") {
            exec("test -e ~/.config/autostart/e-search.desktop", (error, stdout, stderr) => {
                error ? event.sender.send("开机启动状态", false) : event.sender.send("开机启动状态", true);
            });
        } else {
            event.sender.send("开机启动状态", app.getLoginItemSettings().openAtLogin);
        }
    }
});

/**
 * 复制选区，存在变化，回调
 */
async function copy_text(callback: (t: string) => void) {
    var o_clipboard = clipboard.readText();
    if (process.platform == "darwin") {
        exec(
            `osascript -e 'tell application "System Events"' -e 'delay 0.1' -e 'key code 8 using command down' -e 'end tell'`
        );
    } else if (process.platform == "win32") {
        exec(`wscript "${path.join(run_path, "lib/copy.vbs")}"`);
    } else if (process.platform == "linux") {
        exec(store.get("主搜索功能.linux_copy") || "xdotool key ctrl+c");
    }
    setTimeout(() => {
        let t = clipboard.readText();
        let v = "";
        if (o_clipboard != t) v = t;
        for (let i of store.get("主搜索功能.自动搜索排除")) {
            if (t.match(i)) {
                v = "";
                break;
            }
        }
        callback(v);
        clipboard.writeText(o_clipboard);
    }, 300);
}

/** 自动判断选中搜索还是截屏搜索 */
function auto_open() {
    copy_text((t) => {
        if (t) {
            create_main_window("index.html", [t]);
        } else {
            full_screen();
        }
    });
}

/** 选区搜索 */
function open_selection() {
    copy_text((t) => {
        if (t) create_main_window("index.html", [t]);
    });
}

/** 剪贴板搜索 */
function open_clip_board() {
    var t = clipboard.readText(
        process.platform == "linux" && store.get("主搜索功能.剪贴板选区搜索") ? "selection" : "clipboard"
    );
    create_main_window("index.html", [t]);
}

// cil参数重复启动;
var first_open = true;
const isFirstInstance = app.requestSingleInstanceLock();
if (!isFirstInstance) {
    first_open = false;
    app.quit();
} else {
    app.on("second-instance", (event, commanLine, workingDirectory) => {
        arg_run(commanLine);
    });
}

/**
 * 根据命令运行
 * @param {string[]} c 命令
 */
function arg_run(c: string[]) {
    if (c.includes("-d")) dev = true;
    switch (true) {
        case c.includes("-a"):
            auto_open();
            break;
        case c.includes("-c"):
            full_screen();
            break;
        case c.includes("-s"):
            open_selection();
            break;
        case c.includes("-b"):
            open_clip_board();
            break;
        case c.includes("-g"):
            create_main_window("index.html", [""]);
            break;
        case c.includes("-q"):
            quick_clip();
            break;
        default:
            for (let i of c) {
                if (i.match(/(\.png)|(\.jpg)|(\.svg)$/i)) {
                    full_screen(i);
                    break;
                }
            }
            break;
    }
}

async function rm_r(dir_path: string) {
    fs.rm(dir_path, { recursive: true }, (err) => {
        if (err) console.error(err);
    });
}

/**
 * 生成截屏s
 * @param { Screenshots[]} screen_list 截屏列表
 * @returns
 */
function capturer(screen_list: Screenshots[]) {
    let x = [];
    screen_list.forEach((capturer) => {
        let s = capturer.captureSync();
        x.push({
            image: s,
            id: capturer.id,
            x: capturer.x,
            y: capturer.y,
            width: capturer.width,
            height: capturer.height,
            rotation: capturer.rotation,
            scaleFactor: capturer.scaleFactor,
            isPrimary: capturer.isPrimary,
        });
    });
    return x;
}

var contextMenu: Electron.Menu, tray: Tray;

app.whenReady().then(() => {
    if (store.get("首次运行") === undefined) set_default_setting();
    fix_setting_tree();

    // 初始化语言
    lan(store.get("语言.语言"));

    // 初始化设置
    Store.initRenderer();
    // 托盘
    tray =
        process.platform == "linux"
            ? new Tray(`${run_path}/assets/logo/32x32.png`)
            : new Tray(`${run_path}/assets/logo/16x16.png`);
    contextMenu = Menu.buildFromTemplate([
        {
            label: `${t("自动搜索")}`,
            click: () => {
                auto_open();
            },
        },
        {
            label: t("截屏搜索"),
            click: () => {
                setTimeout(() => {
                    full_screen();
                }, store.get("主搜索功能.截屏搜索延迟"));
            },
        },
        {
            label: t("选中搜索"),
            click: () => {
                open_selection();
            },
        },
        {
            label: t("剪贴板搜索"),
            click: () => {
                open_clip_board();
            },
        },
        {
            type: "separator",
        },
        {
            label: t("OCR(文字识别)"),
            click: () => {
                let s = Screenshots.fromDisplay(screen.getPrimaryDisplay().id);
                clip_window.webContents.send("reflash", capturer([s]), null, null, "ocr");
                s = null;
            },
        },
        {
            label: t("以图搜图"),
            click: () => {
                let s = Screenshots.fromDisplay(screen.getPrimaryDisplay().id);
                clip_window.webContents.send("reflash", capturer([s]), null, null, "image_search");
                s = null;
            },
        },
        {
            type: "separator",
        },
        {
            label: t("浏览器打开"),
            type: "checkbox",
            checked: store.get("浏览器中打开"),
            click: (i) => {
                store.set("浏览器中打开", i.checked);
            },
        },
        {
            type: "separator",
        },
        {
            label: t("主页面"),
            click: () => {
                create_main_window("index.html", [""]);
            },
        },
        {
            label: t("设置"),
            click: () => {
                Store.initRenderer();
                create_main_window("setting.html");
            },
        },
        {
            label: t("教程帮助"),
            click: () => {
                create_main_window("help.html");
            },
        },
        {
            type: "separator",
        },
        {
            label: t("重启"),
            click: () => {
                app.relaunch();
                app.exit(0);
            },
        },
        {
            label: t("退出"),
            click: () => {
                app.quit();
            },
        },
    ]);
    if (store.get("点击托盘自动截图")) {
        tray.on("click", () => {
            full_screen();
        });
        tray.on("right-click", () => {
            tray.popUpContextMenu(contextMenu);
        });
    } else {
        tray.setContextMenu(contextMenu);
    }

    // 启动时提示
    if (first_open && store.get("启动提示"))
        new Notification({
            title: app.name,
            body: `${app.name} ${t("已经在后台启动")}`,
            icon: `${run_path}/assets/logo/64x64.png`,
        }).show();

    // 快捷键
    var 快捷键函数 = {
        自动识别: { f: "auto_open()" },
        截屏搜索: { f: "full_screen()" },
        选中搜索: { f: "open_selection()" },
        剪贴板搜索: { f: "open_clip_board()" },
        快速截屏: { f: "quick_clip()" },
        主页面: { f: "create_main_window('index.html', [''])" },
    };
    // var 快捷键函数2 = {
    //     自动识别: { f: auto_open() },
    //     截屏搜索: { f: full_screen() },
    //     选中搜索: { f: open_selection() },
    //     剪贴板搜索: { f: open_clip_board() },
    //     快速截屏: { f: quick_clip() },
    //     主页面: { f: create_main_window("index.html", [""]) },
    // };
    ipcMain.on("快捷键", (event, arg) => {
        var [name, key] = arg;
        try {
            try {
                globalShortcut.unregister(store.get(`快捷键.${name}.key`));
            } catch {}
            let ok = false;
            if (key) {
                ok = globalShortcut.register(key, () => {
                    eval(快捷键函数[arg[0]].f);
                });
            }
            // key为空或成功注册时保存，否则存为空
            store.set(`快捷键.${name}.key`, key === "" || ok ? key : "");
            event.sender.send("状态", name, key ? ok : true);
        } catch (error) {
            event.sender.send("状态", name, false);
            store.set(`快捷键.${name}.key`, "");
        }
    });

    var /**@type {Object} */ 快捷键: object = store.get("快捷键");
    for (let k in 快捷键) {
        var m = 快捷键[k];
        try {
            if (m.key)
                globalShortcut.register(m.key, () => {
                    eval(快捷键函数[k].f);
                });
        } catch (error) {
            delete 快捷键[k].key;
            store.set(`快捷键`, 快捷键);
        }
    }

    // tmp目录
    if (!fs.existsSync(os.tmpdir() + "/eSearch")) fs.mkdir(os.tmpdir() + "/eSearch", () => {});
    create_clip_window();

    nativeTheme.themeSource = store.get("全局.深色模式");
});

app.on("will-quit", () => {
    // Unregister all shortcuts.
    globalShortcut.unregisterAll();

    // 删除临时文件夹
    rm_r(path.join(os.tmpdir(), "eSearch"));
});

var the_icon = null;
if (process.platform == "win32") {
    the_icon = path.join(run_path, "assets/logo/icon.ico");
} else {
    the_icon = path.join(run_path, "assets/logo/1024x1024.png");
}

// 截屏窗口
/**
 * @type BrowserWindow
 */
var clip_window: BrowserWindow = null;
var clip_window_loaded = false;
/** 初始化截屏后台窗口 */
function create_clip_window() {
    clip_window = new BrowserWindow({
        icon: the_icon,
        width: screen.getPrimaryDisplay().workAreaSize.width,
        height: screen.getPrimaryDisplay().workAreaSize.height,
        show: false,
        alwaysOnTop: !dev, // 为了方便调试，调试模式就不居上了
        fullscreenable: true,
        transparent: true,
        frame: false,
        resizable: process.platform == "linux", // gnome下为false时无法全屏
        skipTaskbar: true,
        autoHideMenuBar: true,
        movable: false,
        enableLargerThanScreen: true, // mac
        hasShadow: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    if (!dev) clip_window.setAlwaysOnTop(true, "screen-saver");

    renderer_path(clip_window, "capture.html");
    clip_window.webContents.on("did-finish-load", () => {
        clip_window.webContents.setZoomFactor(store.get("全局.缩放") || 1.0);
        if (clip_window_loaded) return;
        clip_window_loaded = true;
        if (first_open) arg_run(process.argv);
    });

    if (dev) clip_window.webContents.openDevTools();

    // * 监听截屏奇奇怪怪的事件
    ipcMain.on("clip_main_b", (event, type, arg) => {
        switch (type) {
            case "window-close":
                n_full_screen();
                break;
            case "ocr":
                ocr(event, arg);
                break;
            case "search":
                image_search(event, arg);
                break;
            case "QR":
                if (arg != "nothing") {
                    create_main_window("index.html", [arg]);
                } else {
                    dialog.showMessageBox({
                        title: t("警告"),
                        message: `${t("无法识别二维码")}\n${t("请尝试重新识别")}`,
                        icon: `${run_path}/assets/logo/warning.png`,
                    });
                }
                break;
            case "open":
                dialog
                    .showOpenDialog({
                        title: t("选择要打开应用的位置"),
                    })
                    .then((x) => {
                        console.log(x);
                        event.sender.send("open_path", x.filePaths[0]);
                    });
                break;
            case "save":
                var saved_path = store.get("保存.保存路径.图片") || "";
                n_full_screen();
                dialog
                    .showSaveDialog({
                        title: t("选择要保存的位置"),
                        defaultPath: path.join(saved_path, `${get_file_name()}.${arg}`),
                        filters: [{ name: t("图像"), extensions: [arg] }],
                    })
                    .then((x) => {
                        event.sender.send("save_path", x.filePath);
                        if (x.filePath) {
                        } else {
                            new Notification({
                                title: `${app.name} ${t("保存图像失败")}`,
                                body: t("用户已取消保存"),
                                icon: `${run_path}/assets/logo/64x64.png`,
                            }).show();
                            clip_window.show();
                            clip_window.setSimpleFullScreen(true);
                        }
                    });
                break;
            case "ding":
                create_ding_window(arg[0], arg[1], arg[2], arg[3], arg[4]);
                break;
            case "mac_app":
                n_full_screen();
                dialog
                    .showOpenDialog({
                        defaultPath: "/Applications",
                    })
                    .then((x) => {
                        if (x.canceled) {
                            clip_window.show();
                            clip_window.setSimpleFullScreen(true);
                        }
                        event.sender.send("mac_app_path", x.canceled, x.filePaths);
                    });
                break;
            case "ok_save":
                noti(arg);
                store.set("保存.保存路径.图片", path.dirname(arg));
                break;
            case "record":
                create_recorder_window(arg);
                break;
            case "long_s":
                // n_full_screen();
                long_s_v = true;
                long_s(arg[4]);
                long_win(arg);
                break;
            case "long_e":
                long_s_v = false;
                break;
            case "new_version":
                var notification = new Notification({
                    title: `${app.name} ${t("有新版本：")}${arg.v}`,
                    body: `${t("点击下载")}`,
                    icon: `${run_path}/assets/logo/64x64.png`,
                });
                notification.on("click", () => {
                    shell.openExternal(arg.url);
                });
                notification.show();
                break;
        }
    });
}

/**
 * 获取图片并全屏
 * @param {?string} img_path 路径
 */
function full_screen(img_path?: string) {
    let nearest_screen = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    if (img_path) {
        console.log(img_path);
        fs.readFile(img_path, (err, data) => {
            if (err) console.error(err);
            let p = nativeImage.createFromBuffer(data);
            let s = p.getSize();
            clip_window.webContents.send("reflash", {
                image: data,
                width: s.width,
                heigth: s.height,
                isPrimary: true,
                id: screen.getPrimaryDisplay().id,
            });
        });
    } else {
        // 获取所有屏幕截图
        let all = Screenshots.all() ?? [];
        let x = capturer(all);
        let have_main = false;
        for (let i of x) {
            if (i.id == nearest_screen.id) {
                i["main"] = true;
                have_main = true;
                break;
            }
        }
        if (!have_main) x[0]["main"] = true;
        clip_window.webContents.send("reflash", x);
        x = null;
    }
    clip_window.setBounds({ x: nearest_screen.bounds.x, y: nearest_screen.bounds.y });
    clip_window.show();
    clip_window.setSimpleFullScreen(true);
}

/** 隐藏截屏窗口 */
function n_full_screen() {
    clip_window.setSimpleFullScreen(false);
    clip_window.hide();
}

/** 刷新（初始化）截屏窗口 */
function reload_clip() {
    n_full_screen();
    if (clip_window && !clip_window.isDestroyed() && !clip_window.isVisible()) clip_window.reload();
}

var ocr_event: Electron.IpcMainEvent;
function ocr(event: Electron.IpcMainEvent, arg) {
    create_main_window("index.html", ["ocr", ...arg]);
    ocr_event = event;
}

var image_search_event: Electron.IpcMainEvent;
function image_search(event: Electron.IpcMainEvent, arg) {
    create_main_window("index.html", ["image", arg[0], arg[1]]);
    image_search_event = event;
}

var /** @type {BrowserWindow}*/ recorder: BrowserWindow;
var o_rect;
function create_recorder_window(rect) {
    o_rect = rect;
    let ratio = screen.getPrimaryDisplay().scaleFactor;
    let p = { x: screen.getCursorScreenPoint().x * ratio, y: screen.getCursorScreenPoint().y * ratio };
    rect = rect.map((v) => v / ratio);
    let hx = rect[0] + rect[2] / 2,
        hy = rect[1] + rect[3] / 2,
        w = 216,
        h = 24,
        sw = screen.getPrimaryDisplay().bounds.width * ratio,
        sh = screen.getPrimaryDisplay().bounds.height * ratio;
    let x = p.x <= hx ? rect[0] : rect[0] + rect[2] - w,
        y = p.y <= hy ? rect[1] - h - 8 : rect[1] + rect[3] + 8;
    x = x < 0 ? 0 : x;
    x = x + w > sw ? sw - w : x;
    y = y < 0 ? 0 : y;
    y = y + h > sh ? sh - h : y;
    x = Math.round(x);
    y = Math.round(y);
    recorder = new BrowserWindow({
        icon: the_icon,
        x,
        y,
        width: w,
        height: h,
        transparent: true,
        frame: false,
        autoHideMenuBar: true,
        resizable: process.platform == "linux",
        titleBarStyle: "hiddenInset",
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });
    renderer_path(recorder, "recorder.html");
    if (dev) recorder.webContents.openDevTools();

    recorder.setAlwaysOnTop(true, "screen-saver");

    recorder.on("close", () => {
        store.set("录屏.大小.x", recorder.getBounds().x);
        store.set("录屏.大小.y", recorder.getBounds().y);
        reload_clip();
        clip_window.setIgnoreMouseEvents(false);
    });

    recorder.on("resize", () => {
        if (recorder.isResizable()) {
            store.set("录屏.大小.width", recorder.getBounds().width);
            store.set("录屏.大小.height", recorder.getBounds().height);
        }
    });

    recorder.webContents.on("did-finish-load", () => {
        desktopCapturer.getSources({ types: ["screen"] }).then((sources) => {
            recorder.webContents.send("record", "init", sources[0].id, rect);
        });
    });

    globalShortcut.register("Super+R", () => {
        if (!recorder.isDestroyed()) {
            recorder.webContents.send("record", "start_stop");
        }
    });

    clip_window.setIgnoreMouseEvents(true);

    function mouse() {
        if (clip_window.isDestroyed()) return;
        let n_xy = screen.getCursorScreenPoint();
        clip_window.webContents.send("record", "mouse", { x: n_xy.x, y: n_xy.y });
        setTimeout(mouse, 10);
    }
    if (store.get("录屏.提示.光标.开启")) mouse();
}

ipcMain.on("record", (event, type, arg, arg1) => {
    switch (type) {
        case "stop":
            reload_clip();
            clip_window.setIgnoreMouseEvents(false);
            break;
        case "start":
            break;
        case "ff": // 处理视频
            var saved_path = store.get("保存.保存路径.视频") || "";
            dialog
                .showSaveDialog({
                    title: t("选择要保存的位置"),
                    defaultPath: path.join(saved_path, `${get_file_name()}.${arg.格式}`),
                    filters: [{ name: t("视频"), extensions: null }],
                })
                .then(async (x) => {
                    if (x.filePath) {
                        const { createFFmpeg, fetchFile } = require("@ffmpeg/ffmpeg");
                        const ffmpeg = createFFmpeg({ log: false });
                        await ffmpeg.load();
                        let i_fn = path.basename(arg.源文件),
                            o_fn = path.basename(x.filePath);
                        ffmpeg.setProgress(({ ratio }) => {
                            if (!recorder.isDestroyed()) {
                                recorder.webContents.send("ff", "p", ratio);
                            }
                        });
                        ffmpeg.setLogger(({ type, message }) => {
                            if (!recorder.isDestroyed()) {
                                recorder.webContents.send("ff", "l", [type, message]);
                            }
                        });
                        ffmpeg.FS("writeFile", i_fn, await fetchFile(arg.源文件));
                        if (arg.格式 == "gif" && store.get("录屏.转换.高质量gif")) {
                            await ffmpeg.run(
                                "-i",
                                i_fn,
                                ...arg.参数,
                                "-vf",
                                `"[in]crop=${o_rect[2]}:${o_rect[3]}:${o_rect[0]}:${o_rect[1]},split[split1][split2];[split1]palettegen=stats_mode=single[pal];[split2][pal]paletteuse=new=1"`,
                                o_fn
                            );
                        } else {
                            await ffmpeg.run(
                                "-i",
                                i_fn,
                                ...arg.参数,
                                "-vf",
                                `crop=${o_rect[2]}:${o_rect[3]}:${o_rect[0]}:${o_rect[1]}`,
                                o_fn
                            );
                        }
                        await fs.promises.writeFile(x.filePath, ffmpeg.FS("readFile", o_fn));
                        noti(x.filePath);
                        store.set("保存.保存路径.视频", path.dirname(x.filePath));
                        ffmpeg.exit();
                    } else {
                        new Notification({
                            title: `${app.name} ${t("保存视频失败")}`,
                            body: t("用户已取消保存"),
                            icon: `${run_path}/assets/logo/64x64.png`,
                        }).show();
                    }
                });
            break;
        case "close":
            recorder.close();
            break;
        case "min":
            recorder.minimize();
            break;
        case "camera":
            switch (arg) {
                case 0:
                    recorder.setBounds({
                        width: store.get("录屏.大小.width") || 800,
                        height: store.get("录屏.大小.height") || 600,
                        x: recorder.getBounds().x,
                        y: recorder.getBounds().y,
                    });
                    recorder.setResizable(true);
                    break;
                case 1:
                    recorder.setResizable(false);
                    recorder.setBounds({
                        width: 216,
                        height: 24,
                        x: recorder.getBounds().x,
                        y: recorder.getBounds().y,
                    });
                    break;
                case 2:
                    recorder.setBounds({
                        width: store.get("录屏.大小.width") || 800,
                        height: store.get("录屏.大小.height") || 600,
                    });
                    recorder.setAlwaysOnTop(false);
                    recorder.setResizable(true);
                    recorder.center();
                    break;
            }
            break;
        case "pause_time":
            break;
    }
});

ipcMain.on("setting", async (event, arg, arg1, arg2) => {
    switch (arg) {
        case "save_err":
            console.log("保存设置失败");
            break;
        case "reload_main":
            if (clip_window && !clip_window.isDestroyed() && !clip_window.isVisible()) clip_window.reload();
            contextMenu.items[8].checked = store.get("浏览器中打开");
            tray.popUpContextMenu(contextMenu);
            break;
        case "set_default_setting":
            store.clear();
            set_default_setting();
            var resolve = await dialog.showMessageBox({
                title: t("重启"),
                message: `${t("已恢复默认设置，部分设置需要重启")} ${app.name} ${t("生效")}`,
                buttons: [t("重启"), t("稍后")],
                defaultId: 0,
                cancelId: 1,
            });
            if (resolve.response == 0) {
                app.relaunch();
                app.exit(0);
            }
            break;
        case "find":
            if (arg1.o?.start) {
                let o = arg1.o;
                delete arg1.o.start;
                event.sender.findInPage(arg1.t, o || {});
            } else {
                event.sender.stopFindInPage("clearSelection");
            }
            break;
        case "reload":
            app.relaunch();
            app.exit(0);
            break;
        case "clear":
            let ses = session.defaultSession;
            if (arg1 == "storage") {
                ses.clearStorageData()
                    .then(() => {
                        event.sender.send("setting", "storage", true);
                    })
                    .catch(() => {
                        event.sender.send("setting", "storage", false);
                    });
            } else {
                Promise.all([
                    ses.clearAuthCache(),
                    ses.clearCache(),
                    ses.clearCodeCaches({}),
                    ses.clearHostResolverCache(),
                ])
                    .then(() => {
                        event.sender.send("setting", "cache", true);
                    })
                    .catch(() => {
                        event.sender.send("setting", "cache", false);
                    });
            }
            break;
        case "open_dialog":
            dialog.showOpenDialog(arg1).then((x) => {
                event.sender.send("setting", arg, arg2, x);
            });
            break;
        case "move_user_data":
            if (!arg1) return;
            const to_path = path.resolve(arg1);
            const pre_path = app.getPath("userData");
            fs.mkdirSync(to_path, { recursive: true });
            if (process.platform == "win32") {
                exec(`xcopy ${pre_path}\\** ${to_path} /Y /s`);
            } else {
                exec(`cp -r ${pre_path}/** ${to_path}`);
            }
    }
});

// 长截屏

var long_s_v = false;

function long_s(id: number) {
    if (long_s_v) {
        let s = Screenshots.fromDisplay(id);
        let x = nativeImage.createFromBuffer(capturer([s])[0].image);
        clip_window.webContents.send("long", x.getBitmap(), x.getSize().width, x.getSize().height);
        s = x = null;
        setTimeout(() => {
            long_s(id);
        }, 200);
    } else {
        clip_window.webContents.send("long", null);
    }
}

function long_win(rect) {
    clip_window.setIgnoreMouseEvents(true);
    function mouse() {
        if (!long_s_v) {
            clip_window.setIgnoreMouseEvents(false);
            return;
        }
        if (clip_window.isDestroyed()) return;
        let n_xy = screen.getCursorScreenPoint();
        let ratio = screen.getPrimaryDisplay().scaleFactor;
        if (
            rect[0] + rect[2] - 16 <= n_xy.x * ratio &&
            n_xy.x * ratio <= rect[0] + rect[2] &&
            rect[1] + rect[3] - 16 <= n_xy.y * ratio &&
            n_xy.y * ratio <= rect[1] + rect[3]
        ) {
            clip_window.setIgnoreMouseEvents(false);
        } else {
            clip_window.setIgnoreMouseEvents(true);
        }
        setTimeout(mouse, 10);
    }
    mouse();
}

// 菜单栏设置(截屏没必要)
const isMac = process.platform === "darwin";
const template = [
    // { role: 'appMenu' }
    ...(isMac
        ? [
              {
                  label: app.name,
                  submenu: [
                      { label: `${t("关于")} ${app.name}`, role: "about" },
                      { type: "separator" },
                      {
                          label: t("设置"),
                          click: () => {
                              create_main_window("setting.html");
                          },
                          accelerator: "CmdOrCtrl+,",
                      },
                      { type: "separator" },
                      { label: t("服务"), role: "services" },
                      { type: "separator" },
                      { label: `${t("隐藏")} ${app.name}`, role: "hide" },
                      { label: t("隐藏其他"), role: "hideOthers" },
                      { label: t("全部显示"), role: "unhide" },
                      { type: "separator" },
                      { label: `退出 ${app.name}`, role: "quit" },
                  ],
              },
          ]
        : []),
    // { role: 'fileMenu' }
    {
        label: t("文件"),
        submenu: [
            {
                label: t("保存到历史记录"),
                click: (i, w) => {
                    main_edit(w, "save");
                },
                accelerator: "CmdOrCtrl+S",
            },
            { type: "separator" },
            ...(isMac
                ? []
                : [
                      {
                          label: t("设置"),
                          click: () => {
                              create_main_window("setting.html");
                          },
                          accelerator: "CmdOrCtrl+,",
                      },
                      { type: "separator" },
                  ]),
            {
                label: t("其他编辑器打开"),
                click: (i, w) => {
                    main_edit(w, "edit_on_other");
                },
            },
            {
                label: t("打开方式..."),
                click: (i, w) => {
                    main_edit(w, "choose_editer");
                },
            },
            { type: "separator" },
            { label: t("关闭"), role: "close" },
        ],
    },
    // { role: 'editMenu' }
    {
        label: t("编辑"),
        submenu: [
            {
                label: t("打开链接"),
                click: (i, w) => {
                    main_edit(w, "link");
                },
                accelerator: "CmdOrCtrl+Shift+L",
            },
            {
                label: t("搜索"),
                click: (i, w) => {
                    main_edit(w, "search");
                },
                accelerator: "CmdOrCtrl+Shift+S",
            },
            {
                label: t("翻译"),
                click: (i, w) => {
                    main_edit(w, "translate");
                },
                accelerator: "CmdOrCtrl+Shift+T",
            },
            { type: "separator" },
            {
                label: t("撤销"),
                click: (i, w) => {
                    main_edit(w, "undo");
                },
                accelerator: "CmdOrCtrl+Z",
            },
            {
                label: t("重做"),
                click: (i, w) => {
                    main_edit(w, "redo");
                },
                accelerator: isMac ? "Cmd+Shift+Z" : "Ctrl+Y",
            },
            { type: "separator" },
            {
                label: t("剪切"),
                click: (i, w) => {
                    main_edit(w, "cut");
                },
                accelerator: "CmdOrCtrl+X",
            },
            {
                label: t("复制"),
                click: (i, w) => {
                    main_edit(w, "copy");
                },
                accelerator: "CmdOrCtrl+C",
            },
            {
                label: t("粘贴"),
                click: (i, w) => {
                    main_edit(w, "paste");
                },
                accelerator: "CmdOrCtrl+V",
            },
            {
                label: t("删除"),
                click: (i, w) => {
                    main_edit(w, "delete");
                },
            },
            {
                label: t("全选"),
                click: (i, w) => {
                    main_edit(w, "select_all");
                },
                accelerator: "CmdOrCtrl+A",
            },
            {
                label: t("自动删除换行"),
                click: (i, w) => {
                    main_edit(w, "delete_enter");
                },
            },
            { type: "separator" },
            {
                label: t("查找"),
                click: (i, w) => {
                    main_edit(w, "show_find");
                },
                accelerator: "CmdOrCtrl+F",
            },
            {
                label: t("替换"),
                click: (i, w) => {
                    main_edit(w, "show_find");
                },
                accelerator: isMac ? "CmdOrCtrl+Option+F" : "CmdOrCtrl+H",
            },
            { type: "separator" },
            {
                label: t("自动换行"),
                click: (i, w) => {
                    main_edit(w, "wrap");
                },
            },
            {
                label: t("拼写检查"),
                click: (i, w) => {
                    main_edit(w, "spellcheck");
                },
            },
            { type: "separator" },
            ...(isMac
                ? [
                      {
                          label: t("朗读"),
                          submenu: [
                              { label: t("开始朗读"), role: "startSpeaking" },
                              { label: t("停止朗读"), role: "stopSpeaking" },
                          ],
                      },
                  ]
                : []),
        ],
    },
    {
        label: t("浏览器"),
        submenu: [
            {
                label: t("后退"),
                click: (i, w) => {
                    view_events(w, "back");
                },
                accelerator: isMac ? "Command+[" : "Alt+Left",
            },
            {
                label: t("前进"),
                click: (i, w) => {
                    view_events(w, "forward");
                },
                accelerator: isMac ? "Command+]" : "Alt+Right",
            },
            {
                label: t("刷新"),
                click: (i, w) => {
                    view_events(w, "reload");
                },
                accelerator: "F5",
            },
            {
                label: t("停止加载"),
                click: (i, w) => {
                    view_events(w, "stop");
                },
                accelerator: "Esc",
            },
            {
                label: t("浏览器打开"),
                click: (i, w) => {
                    view_events(w, "browser");
                },
            },
            {
                label: t("保存到历史记录"),
                click: (i, w) => {
                    view_events(w, "add_history");
                },
                accelerator: "CmdOrCtrl+D",
            },
            {
                label: t("开发者工具"),
                click: (i, w) => {
                    view_events(w, "dev");
                },
            },
        ],
    },
    // { role: 'viewMenu' }
    {
        label: t("视图"),
        submenu: [
            { label: t("重新加载"), role: "reload" },
            { label: t("强制重载"), role: "forceReload" },
            { label: t("开发者工具"), role: "toggleDevTools" },
            { type: "separator" },
            {
                label: t("历史记录"),
                click: (i, w) => {
                    main_edit(w, "show_history");
                },
                accelerator: "CmdOrCtrl+Shift+H",
            },
            { type: "separator" },
            { label: t("实际大小"), role: "resetZoom", accelerator: "" },
            { label: t("放大"), role: "zoomIn" },
            { label: t("缩小"), role: "zoomOut" },
            { type: "separator" },
            { label: t("全屏"), role: "togglefullscreen" },
        ],
    },
    // { role: 'windowMenu' }
    {
        label: t("窗口"),
        submenu: [
            { label: t("最小化"), role: "minimize" },
            { label: t("关闭"), role: "close" },
            ...(isMac
                ? [
                      { type: "separator" },
                      { label: t("置于最前面"), role: "front" },
                      { type: "separator" },
                      { label: t("窗口"), role: "window" },
                  ]
                : []),
        ],
    },
    {
        label: t("帮助"),
        role: "help",
        submenu: [
            {
                label: t("教程帮助"),
                click: () => {
                    create_main_window("help.html");
                },
            },
            { type: "separator" },
            {
                label: t("关于"),
                click: () => {
                    create_main_window("setting.html", true);
                },
            },
        ],
    },
] as (Electron.MenuItemConstructorOptions | Electron.MenuItem)[];
const menu = Menu.buildFromTemplate(template);
Menu.setApplicationMenu(menu);

// ding窗口
var ding_windows_l = { dock: [0, 0, 10, 50] };
var ding_window: BrowserWindow;
function create_ding_window(x: number, y: number, w: number, h: number, img) {
    if (Object.keys(ding_windows_l).length == 1) {
        ding_window = new BrowserWindow({
            icon: the_icon,
            simpleFullscreen: true,
            fullscreen: true,
            transparent: true,
            frame: false,
            alwaysOnTop: true,
            skipTaskbar: true,
            autoHideMenuBar: true,
            enableLargerThanScreen: true, // mac
            hasShadow: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
            },
        });

        renderer_path(ding_window, "ding.html");
        if (dev) ding_window.webContents.openDevTools();
        ding_window.webContents.on("did-finish-load", () => {
            ding_window.webContents.setZoomFactor(store.get("全局.缩放") || 1.0);
            var id = new Date().getTime();
            ding_window.webContents.send("img", id, x, y, w, h, img);
            ding_windows_l[id] = [x, y, w, h];
        });

        ding_window.setAlwaysOnTop(true, "screen-saver");
    } else {
        var id = new Date().getTime();
        ding_window.webContents.send("img", id, x, y, w, h, img);
        ding_windows_l[id] = [x, y, w, h];
    }
    var can_c_ignore = true;
    ipcMain.on("ding_ignore", (event, v) => {
        can_c_ignore = v;
        if (!v) ding_window.setIgnoreMouseEvents(false);
    });
    ipcMain.on("ding_p_s", (event, wid, p_s) => {
        ding_windows_l[wid] = p_s;
    });
    // 关闭窗口
    ipcMain.on("ding_close", (event, wid) => {
        delete ding_windows_l[wid];
        if (Object.keys(ding_windows_l).length == 1) {
            ding_window.close();
        }
    });
    // 自动改变鼠标穿透
    function ding_click_through() {
        var n_xy = screen.getCursorScreenPoint();
        var ratio = screen.getPrimaryDisplay().scaleFactor;
        var in_window = 0;
        for (let i in Object.values(ding_windows_l)) {
            let ii = Object.values(ding_windows_l)[i];
            // 如果光标在某个窗口上，不穿透
            var x2 = ii[0] + ii[2],
                y2 = ii[1] + ii[3];
            if (ii[0] <= n_xy.x * ratio && n_xy.x * ratio <= x2 && ii[1] <= n_xy.y * ratio && n_xy.y * ratio <= y2) {
                in_window += 1;
            }
        }
        // 窗口可能destroyed
        try {
            if (can_c_ignore)
                if (in_window > 0) {
                    ding_window.setIgnoreMouseEvents(false);
                } else {
                    ding_window.setIgnoreMouseEvents(true);
                }
        } catch {}
        setTimeout(ding_click_through, 10);
    }
    ding_click_through();
}

// 主页面
var main_window_l: { [n: number]: BrowserWindow } = {};

var ocr_run_window: BrowserWindow;
/**
 * @type {BrowserWindow}
 */
var image_search_window: BrowserWindow;
/**
 * @type {Object.<number, Array.<number>>}
 */
var main_to_search_l: { [n: number]: Array<number> } = {};
async function create_main_window(web_page: string, t?: boolean | Array<any>, about?: boolean) {
    var window_name = new Date().getTime();
    var [w, h, m] = store.get("主页面大小");
    let vw = screen.getPrimaryDisplay().bounds.width,
        vh = screen.getPrimaryDisplay().bounds.height,
        px = screen.getCursorScreenPoint().x,
        py = screen.getCursorScreenPoint().y;
    let x = px > vw / 2 ? px - w : px,
        y = py > vh / 2 ? py - h : py;
    var main_window = (main_window_l[window_name] = new BrowserWindow({
        x: x < 0 ? 0 : x,
        y: y < 0 ? 0 : y,
        width: w,
        height: h,
        minWidth: 800,
        backgroundColor: nativeTheme.shouldUseDarkColors ? "#0f0f0f" : "#ffffff",
        icon: the_icon,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
        show: false,
    })) as BrowserWindow & { html: string };

    main_to_search_l[window_name] = [];

    if (m) main_window.maximize();

    // 自定义界面
    renderer_path(main_window, web_page || "index.html");

    await main_window.webContents.session.setProxy(store.get("代理"));

    if (dev) main_window.webContents.openDevTools();

    if (t?.[0] == "image") {
        image_search_window = main_window;
    } else if (t?.[0] == "ocr") {
        ocr_run_window = main_window;
        ocr_run_window.webContents.once("render-process-gone", (e, d) => {
            ocr_event.sender.send("ocr_back", d.reason);
        });
    }

    main_window.webContents.on("did-finish-load", () => {
        if (t?.[0] != "image" && t?.[0] != "ocr") main_window.show();
        main_window.webContents.setZoomFactor(store.get("全局.缩放") || 1.0);
        t = t || [""];
        // 确保切换到index时能传递window_name
        main_window.webContents.send("text", window_name, t);

        if (web_page == "setting.html") {
            main_window.webContents.send("about", about);
            main_window.webContents.send("setting", main_window.id);
        }

        if (main_window.html) {
            main_window.webContents.send("html", main_window.html);
        }
    });

    main_window.on("close", () => {
        store.set("主页面大小", [
            main_window.getNormalBounds().width,
            main_window.getNormalBounds().height,
            main_window.isMaximized(),
        ]);
        for (let i of main_window.getBrowserViews()) {
            // @ts-ignore
            i?.webContents?.destroy();
        }
    });

    main_window.on("closed", () => {
        delete main_window_l[window_name];
    });

    main_window.webContents.on("found-in-page", (e, r) => {
        main_window.webContents.send("found", r.activeMatchOrdinal, r.matches);
    });

    // 浏览器大小适应
    main_window.on("resize", () => {
        setTimeout(() => {
            var [w, h] = main_window.getContentSize();
            for (let i of main_window.getBrowserViews()) {
                if (i.getBounds().width != 0) i.setBounds({ x: 0, y: 0, width: w, height: h - 48 });
            }
        }, 0);
    });

    return window_name;
}

ipcMain.on("main_win", (e, arg, arg1) => {
    switch (arg) {
        case "close":
            BrowserWindow.fromWebContents(e.sender).close();
            break;
        case "ocr":
            ocr_event.sender.send("ocr_back", arg1);
            ocr_run_window.show();
            ocr_run_window = null;
            break;
        case "image_search":
            image_search_event.sender.send("search_back", "ok");
            image_search_window.show();
            image_search_window = null;
            break;
    }
});

/**
 * 向聚焦的主页面发送事件信息
 * @param {String} m
 */
function main_edit(window: BrowserWindow, m: string) {
    window.webContents.send("edit", m);
}

var search_window_l: { [n: number]: BrowserView } = {};
ipcMain.on("open_url", (event, window_name, url) => {
    create_browser(window_name, url);
});

/** 创建浏览器页面 */
async function create_browser(window_name: number, url: string) {
    if (!window_name) window_name = await create_main_window("index.html");

    var win_name = new Date().getTime();

    let main_window = main_window_l[window_name];

    if (main_window.isDestroyed()) return;
    min_views(main_window);
    var view = new Date().getTime();
    var search_view = (search_window_l[view] = new BrowserView({ webPreferences: { webSecurity: false } }));
    await search_view.webContents.session.setProxy(store.get("代理"));
    main_window_l[window_name].addBrowserView(search_view);
    search_view.webContents.loadURL(url);
    var [w, h] = main_window.getContentSize();
    search_view.setBounds({ x: 0, y: 0, width: w, height: h - 48 });
    main_window.setContentSize(w, h + 1);
    main_window.setContentSize(w, h);
    search_view.webContents.setWindowOpenHandler(({ url }) => {
        create_browser(window_name, url);
        return { action: "deny" };
    });
    if (dev) search_view.webContents.openDevTools();
    if (!main_window.isDestroyed()) main_window.webContents.send("url", win_name, view, "new", url);
    search_view.webContents.on("page-title-updated", (event, title) => {
        if (!main_window.isDestroyed()) main_window.webContents.send("url", win_name, view, "title", title);
    });
    search_view.webContents.on("page-favicon-updated", (event, favlogo) => {
        if (!main_window.isDestroyed()) main_window.webContents.send("url", win_name, view, "icon", favlogo);
    });
    search_view.webContents.on("did-navigate", (event, url) => {
        if (!main_window.isDestroyed()) main_window.webContents.send("url", win_name, view, "url", url);
    });
    search_view.webContents.on("did-start-loading", () => {
        if (!main_window.isDestroyed()) main_window.webContents.send("url", win_name, view, "load", true);
    });
    search_view.webContents.on("did-stop-loading", () => {
        if (!main_window.isDestroyed()) main_window.webContents.send("url", win_name, view, "load", false);
    });
    search_view.webContents.on("did-fail-load", (event, err_code, err_des) => {
        renderer_path(search_view.webContents, "browser_bg.html", {
            query: { type: "did-fail-load", err_code: String(err_code), err_des },
        });
        if (dev) search_view.webContents.openDevTools();
    });
    search_view.webContents.on("render-process-gone", () => {
        renderer_path(search_view.webContents, "browser_bg.html", { query: { type: "render-process-gone" } });
        if (dev) search_view.webContents.openDevTools();
    });
    search_view.webContents.on("unresponsive", () => {
        renderer_path(search_view.webContents, "browser_bg.html", { query: { type: "unresponsive" } });
        if (dev) search_view.webContents.openDevTools();
    });
    search_view.webContents.on("responsive", () => {
        search_view.webContents.loadURL(url);
    });
    search_view.webContents.on("certificate-error", () => {
        renderer_path(search_view.webContents, "browser_bg.html", { query: { type: "certificate-error" } });
        if (dev) search_view.webContents.openDevTools();
    });
}
/**
 * 标签页事件
 * @param {BrowserWindow} w 浏览器
 * @param {String} arg 事件字符
 */
function view_events(w: BrowserWindow, arg: string) {
    w.webContents.send("view_events", arg);
}

ipcMain.on("tab_view", (e, id, arg, arg2) => {
    let main_window = BrowserWindow.fromWebContents(e.sender);
    let search_window = search_window_l[id];
    switch (arg) {
        case "close":
            main_window.removeBrowserView(search_window);
            // @ts-ignore
            search_window.webContents.destroy();
            delete search_window_l[id];
            break;
        case "top":
            // 有时直接把主页面当成浏览器打开，这时pid未初始化就触发top了，直接忽略
            if (!main_window) return;
            main_window.setTopBrowserView(search_window);
            min_views(main_window);
            search_window.setBounds({
                x: 0,
                y: 0,
                width: main_window.getContentBounds().width,
                height: main_window.getContentBounds().height - 48,
            });
            break;
        case "back":
            search_window.webContents.goBack();
            break;
        case "forward":
            search_window.webContents.goForward();
            break;
        case "stop":
            search_window.webContents.stop();
            break;
        case "reload":
            search_window.webContents.reload();
            break;
        case "home":
            min_views(main_window);
            break;
        case "save_html":
            main_window["html"] = arg2;
            min_views(main_window);
            break;
        case "dev":
            search_window.webContents.openDevTools();
            break;
    }
});

/** 最小化某个窗口的所有标签页 */
function min_views(main_window: BrowserWindow) {
    for (let v of main_window.getBrowserViews()) {
        v.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
}

/** 生成一个文件名 */
function get_file_name() {
    var save_name_time = time_format(store.get("保存名称.时间"), new Date()).replace("\\", "");
    var file_name = store.get("保存名称.前缀") + save_name_time + store.get("保存名称.后缀");
    return file_name;
}
/** 快速截屏 */
function quick_clip() {
    (Screenshots.all() ?? []).forEach((c) => {
        let image = nativeImage.createFromBuffer(c.captureSync());
        if (store.get("快速截屏.模式") == "clip") {
            clipboard.writeImage(image);
            image = null;
        } else if (store.get("快速截屏.模式") == "path" && store.get("快速截屏.路径")) {
            var file_name = `${store.get("快速截屏.路径")}${get_file_name()}.png`;
            check_file(1, file_name);
        }
        function check_file(n, name) {
            // 检查文件是否存在于当前目录中。
            fs.access(name, fs.constants.F_OK, (err) => {
                if (!err) {
                    /* 存在文件，需要重命名 */
                    name = file_name.replace(/\.png$/, `(${n}).png`);
                    check_file(n + 1, name);
                } else {
                    file_name = name;
                    fs.writeFile(
                        file_name,
                        Buffer.from(image.toDataURL().replace(/^data:image\/\w+;base64,/, ""), "base64"),
                        (err) => {
                            if (err) return;
                            noti(file_name);
                            image = null;
                        }
                    );
                }
            });
        }
    });
}

/** 提示保存成功 */
function noti(file_path: string) {
    var notification = new Notification({
        title: `${app.name} ${t("保存图像成功")}`,
        body: `${t("已保存图像到")} ${file_path}`,
        icon: `${run_path}/assets/logo/64x64.png`,
    });
    notification.on("click", () => {
        shell.showItemInFolder(file_path);
    });
    notification.show();
}

ipcMain.on("get_save_path", (event, path) => {
    if (!path) path = app.getPath("pictures");
    dialog
        .showOpenDialog({
            title: t("选择要保存的位置"),
            defaultPath: path,
            properties: ["openDirectory"],
        })
        .then((x) => {
            if (x.filePaths[0]) event.sender.send("get_save_path", x.filePaths[0] + "/");
        });
});

ipcMain.on("theme", (e, v) => {
    nativeTheme.themeSource = v;
    store.set("全局.深色模式", v);
});

// 默认设置
var default_setting = {
    首次运行: false,
    启动提示: true,
    语言: {},
    快捷键: {
        自动识别: {
            key: "Alt+C",
        },
        截屏搜索: {},
        选中搜索: {},
        剪贴板搜索: {},
        快速截屏: {},
        主页面: {},
    },
    点击托盘自动截图: process.platform != "linux",
    其他快捷键: {
        关闭: "Escape",
        OCR: "Enter",
        以图搜图: "",
        QR码: "",
        图像编辑: isMac ? "Command+D" : "Control+D",
        其他应用打开: "",
        放在屏幕上: "",
        录屏: "",
        长截屏: "",
        复制: isMac ? "Command+C" : "Control+C",
        保存: isMac ? "Command+S" : "Control+S",
        复制颜色: "K",
    },
    主搜索功能: {
        自动搜索排除: [],
        剪贴板选区搜索: true,
        截屏搜索延迟: 0,
    },
    全局: {
        模糊: 25,
        缩放: 1,
        不透明度: 0.4,
        深色模式: "system",
        图标颜色: ["", ""],
    },
    工具栏: {
        按钮大小: 60,
        按钮图标比例: 0.7,
    },
    字体: {
        主要字体: "",
        等宽字体: "",
        记住: false,
        大小: 16,
    },
    编辑器: {
        自动换行: true,
        拼写检查: false,
        行号: true,
        tab: 2,
        光标动画: 0.05,
    },
    工具栏跟随: "展示内容优先",
    取色器默认格式: "HEX",
    自动搜索: true,
    遮罩颜色: "#0008",
    选区颜色: "#0000",
    像素大小: 10,
    取色器大小: 15,
    显示四角坐标: true,
    其他应用打开: "",
    框选: {
        自动框选: {
            开启: false,
            最小阈值: 50,
            最大阈值: 150,
        },
        记忆: { 开启: false, rects: {} },
    },
    图像编辑: {
        默认属性: {
            填充颜色: "#fff",
            边框颜色: "#333",
            边框宽度: 1,
            画笔颜色: "#333",
            画笔粗细: 2,
        },
        复制偏移: {
            x: 10,
            y: 10,
        },
        形状属性: {},
    },
    OCR: {
        类型: "默认",
        离线切换: true,
        记住: false,
    },
    离线OCR: [["默认", "默认/ppocr_det.onnx", "默认/ppocr_rec.onnx", "默认/ppocr_keys_v1.txt"]],
    离线OCR配置: {
        node: false,
    },
    在线OCR: {
        baidu: {
            url: "",
            id: "",
            secret: "",
        },
        youdao: {
            id: "",
            secret: "",
        },
    },
    以图搜图: {
        引擎: "baidu",
        记住: false,
    },
    自动打开链接: false,
    自动搜索中文占比: 0.2,
    浏览器中打开: false,
    浏览器: {
        标签页: {
            自动关闭: true,
            小: false,
            灰度: false,
        },
    },
    保存: {
        默认格式: "png",
        保存路径: { 图片: "", 视频: "" },
    },
    保存名称: { 前缀: "eSearch-", 时间: "YYYY-MM-DD-HH-mm-ss-S", 后缀: "" },
    jpg质量: 1,
    框选后默认操作: "no",
    快速截屏: { 模式: "clip", 路径: "" },
    搜索引擎: [
        ["Google", "https://www.google.com/search?q=%s"],
        ["百度", "https://www.baidu.com/s?wd=%s"],
        ["必应", "https://cn.bing.com/search?q=%s"],
        ["Yandex", "https://yandex.com/search/?text=%s"],
    ],
    翻译引擎: [
        ["Google", "https://translate.google.com.hk/?op=translate&text=%s"],
        ["Deepl", "https://www.deepl.com/translator#any/any/%s"],
        ["金山词霸", "http://www.iciba.com/word?w=%s"],
        ["百度", "https://fanyi.baidu.com/#auto/auto/%s"],
        ["腾讯", "https://fanyi.qq.com/?text=%s"],
        ["聚合", "https://esearch-translator.netlify.app/?text=%s"],
    ],
    引擎: {
        记住: false,
        默认搜索引擎: "百度",
        默认翻译引擎: "Google",
    },
    历史记录设置: {
        保留历史记录: true,
        自动清除历史记录: false,
        d: 14,
        h: 0,
    },
    ding_dock: [0, 0],
    贴图: {
        窗口: {
            变换: `transform: rotateY(180deg);`,
        },
    },
    代理: {
        mode: "direct",
        pacScript: "",
        proxyRules: "",
        proxyBypassRules: "",
    },
    主页面大小: [800, 600, false],
    关闭窗口: {
        失焦: { 主页面: false },
    },
    时间格式: "MM/DD hh:mm:ss",
    硬件加速: true,
    更新: {
        检查更新: true,
        频率: "setting",
        dev: false,
        上次更新时间: 0,
    },
    录屏: {
        自动录制: 3,
        视频比特率: 2.5,
        摄像头: {
            默认开启: false,
            记住开启状态: false,
            镜像: false,
        },
        音频: {
            默认开启: false,
            记住开启状态: false,
        },
        转换: {
            ffmpeg: "",
            自动转换: false,
            格式: "webm",
            码率: 2.5,
            帧率: 30,
            其他: "",
            高质量gif: false,
        },
        提示: {
            键盘: {
                开启: false,
            },
            鼠标: {
                开启: false,
            },
            光标: {
                开启: false,
                样式: "width: 24px;\nheight: 24px;\nborder-radius: 50%;\nbackground-color: #ff08;",
            },
        },
    },
    插件: { 加载前: [], 加载后: [] },
};
try {
    default_setting.保存.保存路径.图片 = app.getPath("pictures");
    default_setting.保存.保存路径.视频 = app.getPath("videos");
} catch (e) {
    console.error(e);
}

function set_default_setting() {
    for (let i in default_setting) {
        if (i == "语言") {
            store.set(i, { 语言: app.getLocale() || "zh-HANS" });
        } else {
            store.set(i, default_setting[i]);
        }
    }
}

// 增加设置项后，防止undefined
function fix_setting_tree() {
    var tree = "default_setting";
    walk(tree);
    function walk(path: string) {
        var x = eval(path);
        if (Object.keys(x).length == 0) {
            path = path.slice(tree.length + 1); /* 去除开头主tree */
            if (store.get(path) === undefined) store.set(path, x);
        } else {
            for (let i in x) {
                var c_path = path + "." + i;
                if (x[i].constructor === Object) {
                    walk(c_path);
                } else {
                    c_path = c_path.slice(tree.length + 1); /* 去除开头主tree */
                    if (store.get(c_path) === undefined) store.set(c_path, x[i]);
                }
            }
        }
    }
}
