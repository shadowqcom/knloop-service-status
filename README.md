# knloop Status Page

 使用 Github Actions 监测knloop及周边服务的运行状态，并使用 GitHub Pages 进行页面展示。

## 查看效果

[status.knloop.com](https://status.knloop.com)

## 配置说明

1. Fork 本项目 [knloop Status Page](https://github.com/shadowqcom/service-status/).
2. 修改 `urls.cfg` 文件中的url为你想要监测的服务。  
  
```cfg
key1=https://example.com
key2=https://knloop.com
```

3. 修改 `index.html` 中的title和标题.

```html
<title>knloop Status Page</title>
<h1>Services Status</h1>
```

4. 配置GitHub Pages.


## 工作原理

该项目使用 GitHub Actions 每10分钟唤醒并运行 shell 脚本 `servicecheck.sh` ，该脚本在配置中的每个 url 上运行curl，并将运行结果写入`.log`日志文件然后将其提交到本仓库。  
在`index.html`中动态提取该日志并以易于使用的方式显示。您还可以从自己的基础设施运行该脚本以更频繁地更新状态信息和保存日志数据。

## 感谢

本项目基于[statuspage](https://github.com/statsig-io/statuspage/)