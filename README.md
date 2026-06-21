# 打蚊子游戏 (Mosquito Swatter)

基于纯 HTML/CSS/JS 的 H5 打蚊子游戏，支持触摸和鼠标操作。

## 试玩

直接在浏览器中打开 `index.html` 即可运行，无需构建或服务器。

## 操作方式

| 操作 | PC | 移动端 |
|------|-----|--------|
| 瞄准 | 鼠标拖动炮筒区域 | 手指推动炮筒区域 |
| 炮弹 | 单击炮筒 | 双击炮筒 |
| 激光 | 右键长按 1 秒 | 长按屏幕 1 秒 |
| 飞弹 | 右键单击蚊子附近 | 点击蚊子附近 |

## 蚊子类型

| 编号 | 类型 | 特点 |
|------|------|------|
| 1 | 极速蚊子 | 移动速度极快，建议用飞弹 |
| 2 | 分身蚊子 | 可随机克隆任意蚊子 |
| 3 | 厚血蚊子 | 带血条，一次攻击无法消灭 |
| 4 | 加血蚊子 | 给厚血蚊子回血 |
| 5 | 隐身蚊子 | 周期性隐身 |

## 素材生成

精灵表由 `video_to_spritesheet.py` 脚本自动生成：

```
视频 → FFmpeg 抽帧 → rembg AI 抠图 → 精灵表 PNG
```

依赖：Python 3、FFmpeg、PyTorch、rembg

## 项目结构

```
dawenzi-3D/
├── index.html          # 游戏入口
├── game.js             # 游戏逻辑
├── style.css           # 样式
├── wenzi*_spritesheet.png  # 精灵表素材（5 组）
├── background*.jpg     # 关卡背景
├── zapper.mp3          # 音效
├── meizidan.mp3        # 音效
└── weng.mp3            # 背景音乐
```

## 许可

[MIT](LICENSE)
