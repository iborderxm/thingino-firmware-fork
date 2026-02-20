#!/bin/haserl
Content-type: text/html; charset=UTF-8
Date: <%= $(time_http) %>
Server: <%= $SERVER_SOFTWARE %>
Cache-Control: no-store
Pragma: no-cache

<!DOCTYPE html>
<html lang="en" data-bs-theme="<% html_theme %>">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title><% html_title %></title>
  <link rel="icon" type="image/svg+xml" href="/a/favicon.svg">
<% if is_isolated; then %>
  <link rel="stylesheet" href="/a/bootstrap.min.css">
  <link rel="stylesheet" href="/a/bootstrap-icons.min.css">
  <script src="/a/bootstrap.bundle.min.js"></script>
<% else %>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,100..900;1,100..900&display=swap">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" integrity="sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH" crossorigin="anonymous">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.13.1/font/bootstrap-icons.min.css">
  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js" integrity="sha384-YvpcrYf0tY3lHB60NNkmXc5s9fDVZLESaAA55NDzOxhy9GkcIdslK1eN7N6jIeHz" crossorigin="anonymous"></script>
<% fi %>
  <link rel="stylesheet" href="/a/main.css?ts=<%= $assets_ts %>">
  <script src="/a/main.js?ts=<%= $assets_ts %>"></script>
</head>
<%
configured_channel=$(jct "/etc/prudynt.json" get "recorder.channel" 2>/dev/null || echo "0")
%>

<body id="page-<%= $pagename %>"<% is_isolated && echo -n ' class="paranoid"' %>>

<nav class="navbar navbar-expand-lg bg-body-tertiary">
  <div class="container">
    <a class="navbar-brand d-flex align-items-center gap-2" href="/">
      <img alt="图片：thingino logo" width="150" src="/a/logo.svg">
      <%= $page_title %>
    </a>

    <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#nbMain"
      aria-controls="nbMain" aria-label="切换导航">
      <span class="navbar-toggler-icon"></span>
    </button>

    <div class="collapse navbar-collapse justify-content-end" id="nbMain">
      <ul class="navbar-nav">
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" data-bs-toggle="dropdown" href="#" id="ddInfo" role="button">信息</a>
          <ul aria-labelledby="ddInfo" class="dropdown-menu">
            <li><a class="dropdown-item" href="/info.html">命令和日志</a></li>
            <li><a class="dropdown-item" href="info-diagnostic.cgi">分享诊断信息</a></li>
          </ul>
        </li>
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" data-bs-toggle="dropdown" href="#" id="ddSettings" role="button">设置</a>
          <ul aria-labelledby="ddSettings" class="dropdown-menu">
            <% menu "config" %>
            <li><hr class="dropdown-divider"></li>
            <li><a class="dropdown-item" href="reset.cgi">重置...</a></li>
          </ul>
        </li>
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" data-bs-toggle="dropdown" href="#" id="ddTools" role="button">工具</a>
          <ul aria-labelledby="ddTools" class="dropdown-menu">
            <% menu "tool" %>
            <li><a href="reboot.cgi" class="dropdown-item bg-danger confirm">⏼ 重启</a></li>
          </ul>
        </li>
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" data-bs-toggle="dropdown" href="#" id="ddServices" role="button">服务</a>
          <ul aria-labelledby="ddServices" class="dropdown-menu">
            <% menu "service" %>
          </ul>
        </li>
        <li class="nav-item">
          <a class="nav-link" href="preview.cgi">预览</a>
        </li>
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" data-bs-toggle="dropdown" href="#" id="ddHelp" role="button">帮助</a>
          <ul aria-labelledby="ddHelp" class="dropdown-menu dropdown-menu-lg-end">
            <li><a class="dropdown-item" href="https://thingino.com/">关于 thingino</a></li>
          </ul>
        </li>
      </ul>
    </div>
  </div>
</nav>

<main class="pb-4">
  <div class="container" style="min-height: 80vh">
    <div class="row my-2 x-small">

      <div class="col-11 col-lg-6">
        <div id="button-bar" class="d-flex align-items-center gap-1 mb-2 flex-wrap">
          <button type="button" class="btn btn-secondary" id="motion" title="移动侦测">
            <i class="bi bi-person-walking"></i>
          </button>
          <button type="button" class="btn btn-secondary" id="privacy" title="隐私模式">
            <i class="bi bi-eye-slash"></i>
          </button>
          <div class="btn-group" role="group">
            <button type="button" class="btn btn-secondary" id="daynight" title="夜间模式">
              <i class="bi bi-moon-stars"></i>
            </button>
            <button type="button" class="btn btn-secondary dropdown-toggle dropdown-toggle-split" data-bs-toggle="dropdown" aria-expanded="false">
              <span class="visually-hidden">Toggle Dropdown</span>
            </button>
            <ul class="dropdown-menu">
              <li><button class="dropdown-item btn btn-secondary" type="button" id="color" title="彩色模式">
                <i class="bi bi-palette"></i> 彩色模式
              </button></li>
              <li><button class="dropdown-item btn btn-secondary" type="button" id="ircut" title="红外滤镜">
                <i class="bi bi-transparency"></i> 红外滤镜
              </button></li>
              <li><button class="dropdown-item btn btn-secondary" type="button" id="ir850" title="红外 LED 850 nm">
                <i class="bi bi-lightbulb"></i> 红外 LED 850 nm
              </button></li>
              <li><button class="dropdown-item btn btn-secondary" type="button" id="ir940" title="红外 LED 940 nm">
                <i class="bi bi-lightbulb"></i> 红外 LED 940 nm
              </button></li>
              <li><button class="dropdown-item btn btn-secondary" type="button" id="white" title="白光 LED">
                <i class="bi bi-lightbulb"></i> 白光 LED
              </button></li>
            </ul>
          </div>
          <button type="button" class="btn btn-secondary" id="microphone" title="麦克风">
            <i class="bi bi-mic"></i>
          </button>
          <button type="button" class="btn btn-secondary" id="speaker" title="扬声器">
            <i class="bi bi-volume-up"></i>
          </button>
          <button type="button" class="btn btn-secondary" id="recorder-ch0" data-channel="0" title="主码流录制">
            <i class="bi bi-record"></i>
          </button>
          <button type="button" class="btn btn-secondary" id="recorder-ch1" data-channel="1" title="子码流录制">
            <i class="bi bi-record"></i>
          </button>
          <button type="button" class="btn btn-secondary" title="发送快照" data-bs-toggle="modal" data-bs-target="#sendModal">
            <i class="bi bi-send"></i>
          </button>
        </div>
      </div>

      <div class="col-1">
        <a href="config-daynight.cgi" class="dnd-gain <%= $CSS_SILENT_LINK %>" title="亮度"></a>
      </div>

      <div class="col-4 col-lg-2">
        <div class="progress-stacked memory my-1">
          <div class="progress" role="progressbar" id="pb-memory-active" aria-label="Active" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
            <div class="progress-bar progress-bar-striped progress-bar-animated bg-primary" style="width:100%"></div>
          </div>
          <div class="progress" role="progressbar" id="pb-memory-buffers" aria-label="Buffers" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
            <div class="progress-bar progress-bar-striped progress-bar-animated bg-primary" style="width:100%"></div>
          </div>
          <div class="progress" role="progressbar" id="pb-memory-cached" aria-label="Cached" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
            <div class="progress-bar progress-bar-striped progress-bar-animated bg-primary" style="width:100%"></div>
          </div>
        </div>
        <div class="progress-stacked overlay my-1">
          <div class="progress" role="progressbar" id="pb-overlay-used" aria-label="Overlay" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
            <div class="progress-bar progress-bar-striped progress-bar-animated bg-primary" style="width:100%"></div>
          </div>
        </div>
        <div class="progress-stacked extras my-1">
          <div class="progress" role="progressbar" id="pb-extras-used" aria-label="Extras" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
            <div class="progress-bar progress-bar-striped progress-bar-animated bg-primary" style="width:100%"></div>
          </div>
        </div>
      </div>

      <div class="col-7 col-lg-2 text-end">
        <a href="/x/config-time.cgi" id="time-now" class="<%= $CSS_SILENT_LINK %>"></a>
      </div>

      <div class="col-1 text-end">
        <button type="button" class="btn btn-secondary" id="theme-toggle" title="切换主题">
          <i class="bi bi-brilliance"></i>
        </button>
      </div>

    </div>

<% if ! [ "true" = "$wlanap_enabled" ] && [ -z "$network_gateway" ]; then %>
    <div class="alert alert-warning">
      <p>无网络连接。请 <a href="/config-network.html">检查您的网络设置</a>。</p>
    </div>
<% fi %>

<% if [ "$(cat /etc/TZ)" != "$TZ" ]; then %>
    <div class="alert alert-danger">
      <p>系统环境中的 $TZ 变量需要更新！</p>
      <span class="d-flex flex-wrap gap-3">
        <a class="btn btn-danger" href="reboot.cgi">重启摄像头</a>
        <a class="btn btn-primary" href="config-time.cgi">查看时区设置</a>
      </span>
    </div>
<% fi %>

<% if [ -f /tmp/network-restart.txt ]; then %>
    <div class="alert alert-danger">
      <p>网络设置已更新。重启以应用更改。</p>
      <span class="d-flex flex-wrap gap-3">
        <a class="btn btn-danger" href="reboot.cgi">重启摄像头</a>
        <a class="btn btn-primary" href="/config-network.html">查看网络设置</a>
      </span>
    </div>
<% fi %>

<% if [ -f /tmp/sensor-iq-restart.txt ]; then %>
    <div class="alert alert-danger">
      <p>传感器 IQ 文件已更新。重启以应用更改。</p>
      <span class="d-flex flex-wrap gap-3">
        <a class="btn btn-danger" href="reboot.cgi">重启摄像头</a>
        <a class="btn btn-primary" href="config-sensor.cgi">查看传感器设置</a>
      </span>
    </div>
<% fi %>

<% alerts_read %>
