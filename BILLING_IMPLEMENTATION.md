# Aily Apple 内购与本机积分接入

## 产品决策

用户确认纯客户端架构，不新建后端。StoreKit 2 是订阅权益来源，积分仅为本机使用限制，不能阻止改时钟、清数据、篡改余额或绕过直连模型 Key。

- 基础每日20积分，按本机日期重置，不累积。
- 每日签到额外20积分，当天一次；奖励余额可累积。
- 所有付费 AI 请求共享余额，成功后结算；请求失败释放预留额度。
- 语音一轮用户发言 / AI 回答5积分，其他文字、模型解卦、AI朋友圈等1积分。
- 用户后续确认积分礼物：一朵花3、热饮5、小夜灯8、电影邀约10、旅行明信片10、回忆相册10。每份包含一次AI回应，不另扣文字1积分。通过useLocalChat保存giftId，重试按礼物价；成功模型结果后结算、失败释放。旧演示钱包和剧情只读保留，不换算积分。
- 本机小游戏、记忆查看、天气查询、模型连接诊断不扣积分。
- 无模型的本地演示或安全提示不扣积分。
- 月卡基础总额度100/200/400/1000每天；签到不乘倍数。
- 月卡自动续期，四档同组，苹果订阅等级50x=1，20x=2，10x=3，5x=4。

## 已实现

- src/billing.ts：Dexie独立账本aily-billing-v1，事务内预留/结算/释放、重复签到保护、并行请求余额保护；预留2分钟过期。
- src/BillingPanel.tsx + billing.css：“我的 → 签到与月卡”，实际StoreKit价格、恢复购买、管理订阅、等待批准/失败处理、EULA与纯端限制说明。
- ios/App/App/StoreKitBillingPlugin.swift：AilyBilling插件，Product.products、Product.purchase、AppStore.sync、Transaction.currentEntitlements/updates、Apple verified签名结果、到期/撤销/升级检查，verified交易finish。
- SceneDelegate注册插件，pbxproj加入编译。
- chatService.ts：streamReply预留1或5积分、interpretDivination预留1积分，非空成功输出结算；失败释放。
- App.tsx：CallScreen每轮billingCost=5；useLocalChat透传成本。
- ProfileScreen显示余额并打开BillingPanel。

## Apple后台资源（已真实创建）

App ID 6831134786，组22552658 / Aily Monthly Credits，销售地区CHN。价格回读已确认人民币30/60/90/200。

| 产品ID | ASC订阅ID | 版本ID | 价格 |
|---|---|---|---|
| com.aily.app.monthly.5x | 6831638095 | 1655760b-d17e-4721-b846-7b61c7eed655 | ¥30 |
| com.aily.app.monthly.10x | 6831638080 | cb0f8f9e-78c6-4a96-ba85-0deb68f9f838 | ¥60 |
| com.aily.app.monthly.20x | 6831638294 | c4ba2f55-6c88-4abc-bf2e-5ea43d1b1958 | ¥90 |
| com.aily.app.monthly.50x | 6831638325 | 88255945-fd23-46d0-bbcf-093d989ff89c | ¥200 |

组版本7ca4a325-6c56-4903-8742-304d0f755c9e。zh-Hans与en-US本地化已创建。实际CLI输出保存在.mobile-build/billing-asc。不要重复创建订阅/版本。

## 已验证的证据

- npm run build成功。
- npx vitest run src/billing.test.tsx src/billingMetering.test.ts src/nativeGateway.test.ts：6个测试通过。
- unsigned原生iOS Simulator clean build成功，StoreKitBillingPlugin.swift在arm64和x86_64均编译成功。
- 最新.app已安装并启动在iPhone17Pro 167D50CF-5C44-4056-B06B-134B5EC96839。
- .mobile-build/iap-simulator-final.log为原生构建日志。

## 未完成，不能宣称真实支付已全链路成功

1. Round 2 已补完整价格矩阵（175个Apple计价地区，销售仍仅CHN）与真实App审核截图。四个产品均READY_TO_SUBMIT；已通过原生UI测试确认实际App加载四个StoreKit产品及真实USD显示价格。仍需正式审核/必要的Paid Applications协议、税务、银行与隐私政策核验。
2. 尚无真实StoreKit购买/取消/AskToBuy/恢复/续费/退款沙盒实测。代码测试不是支付验证。
3. Round 3 已上传包含内购的TestFlight 1.0 Build6，build ID 403952bf-7ed2-475f-babb-7273fc3948f7，processingState VALID。IPA .mobile-build/Aily-build6.ipa，归档 .mobile-build/TestFlight-build6.xcarchive，确认打包的JS为index-BTqu8DzA.js包含最新计费。旧Build5不含内购。
4. Round 2 已扩展到73个测试通过（真实Dexie账本、mock原生桥权益、实际chatService计费、ProfileScreen）：每日重置/奖励累积/并发签到/过期预留/订阅等级与撤销/待批准取消不发权益/重复结算/流式中断。发现并修复purchase未检查状态与同时commit的幂等问题。
5. Round 2 已通过InstalledBillingUI XCUITest，用实际App导航、滚动、刷新、截图。正式审核截图在.mobile-build/billing-asc/review；截图无任何交易或价格伪造。四档截图已上传Apple并交付成功。
6. App Store正式上架需要可用的隐私政策链接；当前付费页已提供Apple标准EULA。
7. 如续费/退款通知改变状态，原生listener会重新读currentEntitlements；已消耗积分不会回滚为现金退款，基础每日上限调整为当前有效套餐。

## Round 2 原生验证与下一步

- 原生UI测试结果：.mobile-build/storekit-tests/UIResults-full-prices.xcresult，实际UI5/10/20/50显示US$3.99/8.99/12.99/29.99（模拟器商店币种），CHN后台仍30/60/90/200。
- .mobile-build/storekit-tests为隔离LocalStoreKitHost项目，NativeStoreKit编译同一个生产插件，InstalledBillingUI测试只启动已有com.aily.app，不购买/签到/清数据。
- 隔离本地交易测试未通过：5个测试/6个失败，SKTestSession保存配置、清交易、设置overrides均SKInternalErrorDomain Code3，发生在Product.products之前。主bundle资源/UUID/签名/测试plan均已核对；签名宿主SignedDerivedData仍失败，不能再宣称这些原因已确定。
- 结果日志 .mobile-build/storekit-tests/native-test-signed.log；README有无破坏性的后续诊断。不应重复盲跑、更改用户模拟器、猜测私有entitlement。
- 还可分析StoreKit service日志或使用Apple官方测试fixture验证隔离测试配置；亦可由用户登录沙盒账号，在真机/TestFlight进行实际购买、取消、续费、恢复和退款。
- 不能在未确认沙盒环境时自动触发用户生产Apple账号付款。
- Round2时原生构建已安装到iPhone17Pro，日志.mobile-build/iap-simulator-round2.log；后续Round3已上传TestFlight Build6。
- Round3：Build6已上传并VALID，供真实沙盒验证。现有1个Apple Sandbox tester（ID844fbe2b-ced7-40fe-b595-09bb2be42274），未读取/保存密码。模拟器StoreKit服务日志中sandbox.itunes.apple.com请求401 authentication，不能宣称沙盒已登录；该日志不是本地SKInternalCode3的已确诊原因。
- Round3增加付费页安全与隐私入口、本地日重置/签到奖励累积/模型费用另计说明，并每30秒检查本地跨日或订阅到期，保持持续打开页面的额度/签到按钮更新。
- AppInfo只有zh-Hans名称，未配置公开privacyPolicyURL；正式App Store提交需要用户提供/批准隐私政策公开链接。内购页已链接App内安全与隐私及Apple EULA。
- 需要用户在测试设备登录现有沙盒测试账号，测试购买/取消/恢复/续费/退款；勿索要或回显密码，也不能自动在生产Apple账号付款。开发测试/本地StoreKit不同于正式付费验证。用户Round3选择“可以，我会登录沙盒账号并测试”，尚未提供实测结果；隐私政策选择“暂时没有，先完成TestFlight测试”。
- Round4核验build-beta-detail发现Build6曾MISSING_EXPORT_COMPLIANCE，纠正了仅VALID即可安装的说法。用户明确确认“不使用非豁免加密，更新Build6”后设置usesNonExemptEncryption=false，现在internalBuildState READY_FOR_BETA_TESTING、externalBuildState READY_FOR_BETA_SUBMISSION。Alpha内部组1982cc0e-a2f7-4330-9cd6-3ac84294c414 all-builds访问已核对。源Info.plist加ITSAppUsesNonExemptEncryption=false供后续构建。
- Round4修复计费加入后旧模型测试的基础设施隔离：chatService/chatLocale/safetyLocale三文件mock账本以单独验证模型合同，流式取消改为观察getReader而非固定3微任务。143个测试134通过9失败，9个是原有成人模式/安全词/待确认数/引导记忆文案断言未匹配；不得报告全套测试通过。完整计费73项依然通过。
- 接下来无需继续盲跑原生LocalStoreKit测试或再上传同一Build6；当前等待用户真机沙盒结果。独立本地StoreKit测试故障仍SKInternalCode3；SDK公开文档未提供该内部码确切含义。
- Round5整理TESTFLIGHT_BILLING_CHECKLIST.md（所有真实交易结果保持未测试，不伪造）。从Round3至Round5，仍未收到用户沙盒购买/恢复/续费/退款的实测结果，也没有代理可访问的已认证测试设备；当前全链路验收依赖用户在测试设备执行并反馈。用户此前已选择自行登录测试，不应索取密码或以正式Apple账号试付款。
- 发布证书/配置沿用.mobile-build/testflight-signing与build3-ExportOptions.plist。
- 本轮所有主代理和子代理背景任务均已收集，两个子代理当前inactive。

## 工具与操作注意

使用read/glob/grep，不使用shell grep/find。不要删除模拟器数据或DerivedData未核验绝对路径。新的构建目录为.mobile-build/iap-simulator，不必删旧目录。Native StoreKit没有本地成功模拟，不在网页创建假月卡。缺产品时显示未配置并禁用购买。
