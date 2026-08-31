/*:
 * @plugindesc 按F键显示/隐藏角色信息面板
 * @author 避暑企鹅
 * @help 无特殊参数，直接启用即可。按F键呼出面板，再次按F键关闭。
 */

// 1. 定义信息面板窗口类（继承自Window_Base）
function Window_InfoPanel() {
    this.initialize.apply(this, arguments);
}
// 继承Window_Base
Window_InfoPanel.prototype = Object.create(Window_Base.prototype);
Window_InfoPanel.prototype.constructor = Window_InfoPanel;

// 初始化窗口（设置位置、大小、默认隐藏）
Window_InfoPanel.prototype.initialize = function() {
    // 窗口位置：x=50, y=50；宽=300, 高=400（可自行调整）
    const x = 50;
    const y = 50;
    const width = 300;
    const height = 400;
    // 调用父类构造函数初始化窗口
    Window_Base.prototype.initialize.call(this, x, y, width, height);
    this._visible = false; // 默认隐藏
    this.refresh(); // 绘制初始内容
};

// 刷新窗口内容（核心：绘制角色信息）
Window_InfoPanel.prototype.refresh = function() {
    this.contents.clear(); // 清空内容
    const party = $gameParty.members(); // 获取队伍成员（数组）
    if (party.length === 0) return; // 若队伍为空则不绘制

    let y = 0; // 绘制起始Y坐标
    const lineHeight = this.lineHeight(); // 单行高度（默认36像素）

    // 遍历队伍成员，逐个绘制信息
    party.forEach((actor, index) => {
        // 绘制角色姓名
        this.drawText(actor.name(), 10, y, 100, lineHeight);
        // 绘制等级
        this.drawText(`Lv: ${actor.level}`, 120, y, 60, lineHeight);
        y += lineHeight;

        // 绘制HP（带颜色）
        this.changeTextColor(this.hpColor(actor)); // HP颜色（默认：正常绿色，濒危红色）
        this.drawText(`HP: ${actor.hp}/${actor.mhp}`, 10, y, 200, lineHeight);
        y += lineHeight;

        // 绘制MP（带颜色）
        this.changeTextColor(this.mpColor(actor)); // MP颜色（默认蓝色）
        this.drawText(`MP: ${actor.mp}/${actor.mmp}`, 10, y, 200, lineHeight);
        y += lineHeight * 1.5; // 成员间留空
    });

    // 恢复默认文本颜色（避免影响其他绘制）
    this.resetTextColor();
};

// 重写更新方法（每帧检查是否需要刷新内容）
Window_InfoPanel.prototype.update = function() {
    Window_Base.prototype.update.call(this);
    // 若窗口可见，且数据有变化（如HP减少），则刷新
    if (this._visible) {
        this.refresh();
    }
};

// 2. 修改地图场景（Scene_Map），添加面板逻辑
// 备份原场景初始化方法
const _Scene_Map_createAllWindows = Scene_Map.prototype.createAllWindows;
Scene_Map.prototype.createAllWindows = function() {
    _Scene_Map_createAllWindows.call(this); // 执行原方法
    this.createInfoPanel(); // 创建信息面板
};

// 创建信息面板窗口
Scene_Map.prototype.createInfoPanel = function() {
    this._infoPanel = new Window_InfoPanel();
    this.addWindow(this._infoPanel); // 将窗口添加到场景（自动处理显示/更新）
};

// 3. 监听按键（F键）控制面板显示/隐藏
// 备份原场景按键处理方法
const _Scene_Map_updateScene = Scene_Map.prototype.updateScene;
Scene_Map.prototype.updateScene = function() {
    _Scene_Map_updateScene.call(this); // 执行原方法
    // 按F键切换面板显示状态
    if (Input.isTriggered('f')) {
        this._infoPanel._visible = !this._infoPanel._visible;
        this._infoPanel.setVisible(this._infoPanel._visible);
    }
};