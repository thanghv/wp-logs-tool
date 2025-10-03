<?php
/**
 * Plugin Name: WP Logs Tool
 * Plugin URI:  https://example.com/wp-logs-tool
 * Description: A lightweight developer tool for viewing and managing WordPress logs directly from the admin dashboard.
 * Version:     1.0
 * Author:      WPHueDev
 * Author URI:  https://example.com
 * License:     GPLv2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: wp-logs-tool
 * Domain Path: /languages
 */

// Exit if accessed directly.
if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class WP_Logs_Tool {

    // holds queued messages from PHP during the request
    protected static $queued_messages = array();

    public static function init() {
        // enqueue only in admin screens
        add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue_script' ), 1 );
        add_action( 'admin_footer', array( __CLASS__, 'print_queued_logs' ), 9999 );
    }

    // Enqueue the injected script so it loads on every admin page.
    public static function enqueue_script( $hook ) {
        $handle = 'wp-wplogstool-injected-admin';
        $src = plugin_dir_url( __FILE__ ) . 'injected.js';

        // Load in footer of admin page to ensure admin DOM exists (set $in_footer true)
        // Note: admin_enqueue_scripts provides $hook but we load on all admin pages by default
        wp_enqueue_script( $handle, $src, array(), '1.1', true );

        // Optional tiny inline flag before script runs
        $flag = 'window.__wplogstool_injected_by_wp_admin = true;';
        wp_add_inline_script( $handle, $flag, 'before' );
    }

    // Called by other PHP code (admin-side) to queue a message to be logged in the browser console
    public static function add_log( $text ) {
        if ( ! is_scalar( $text ) ) {
            $text = wp_json_encode( $text );
        }
        self::$queued_messages[] = (string) $text;
    }

    // Print inline JS in admin footer that calls window.wplogstool.log(...) for each queued message.
    public static function print_queued_logs() {
        if ( empty( self::$queued_messages ) ) {
            return;
        }

        // Prepare JS array safely
        $messages_json = wp_json_encode( array_values( self::$queued_messages ) );
        // Inline script: iterate messages and call window.wplogstool.log when available.
        // If wplogstool not available yet, queue calls with a short retry (non-blocking).
        $js = <<<JSCODE
(function(){
  try {
    var msgs = $messages_json;
    function dispatch() {
      try {
        if (window.wplogstool && typeof window.wplogstool.log === 'function') {
          msgs.forEach(function(m){ try{ window.wplogstool.log(String(m)); }catch(e){} });
        } else {
          // retry once after small delay - in case injected.js wasn't parsed yet
          setTimeout(function(){
            if (window.wplogstool && typeof window.wplogstool.log === 'function') {
              msgs.forEach(function(m){ try{ window.wplogstool.log(String(m)); }catch(e){} });
            } else {
              // fallback: print to console directly
              msgs.forEach(function(m){ try{ console.log('[wplogstool fallback] ' + String(m)); }catch(e){} });
            }
          }, 250);
        }
      } catch(e) {
        try { console.log('[wplogstool print error]', e); } catch(err) {}
      }
    }
    dispatch();
  } catch(err) { try { console.log('[wplogstool print error outer]', err); } catch(e) {} }
})();
JSCODE;

        echo "<script type=\"text/javascript\">{$js}</script>\n";
        // clear queued messages for this request
        self::$queued_messages = array();
    }
}

// Initialize plugin
WP_Logs_Tool::init();

/**
 * Procedural helper, so other plugin/theme admin PHP can call:
 * wplogstool_add_log_admin('my message');
 */
function wplogstool_add_log_admin( $text ) {
    WP_Logs_Tool::add_log( $text );
}
