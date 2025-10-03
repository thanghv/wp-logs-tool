=== WP Logs Tool ===
Contributors: WPHueDev
Tags: logs, debug, developer, tools, monitor
Requires at least: 5.5
Tested up to: 6.6
Requires PHP: 7.4
Stable tag: 1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

A lightweight developer tool for viewing and managing WordPress logs directly from the admin dashboard.

== Description ==

**WP Logs Tool** helps developers and site administrators easily view, monitor, and manage log entries inside WordPress.

Features include:
- View PHP error logs from within WordPress.
- Create and store custom debug logs.
- Simple, developer-friendly UI inside the WordPress admin.
- Option to export logs for external analysis.
- Lightweight, no bloat.

This plugin is intended for developers and advanced users who need better visibility into their WordPress environment.

== Installation ==

1. Upload the plugin files to the `/wp-content/plugins/wp-logs-tool` directory, or install the plugin through the WordPress plugins screen directly.
2. Activate the plugin through the 'Plugins' screen in WordPress.
3. Navigate to **Tools → WP Logs Tool** to start viewing logs.

== Frequently Asked Questions ==

= Does this plugin write to my PHP error logs? =
No, it only reads existing logs and provides a custom logging mechanism. It won’t modify your PHP configuration.

= Can I use this on production sites? =
Yes, but it is recommended mainly for staging, development, or debugging purposes.

== Screenshots ==

1. Admin page showing log viewer.
2. Example of custom logs added by developers.

== Changelog ==

= 1.0 =
* Initial release with core features:
  - Admin log viewer
  - Custom log storage
  - Export function

== Upgrade Notice ==

= 1.0 =
First release of WP Logs Tool.

== Credits ==

Created by [Your Name].
