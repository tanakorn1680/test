package com.testnotification

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.provider.Settings
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import androidx.recyclerview.widget.DividerItemDecoration
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.testnotification.data.AppState
import com.testnotification.data.NotificationLog
import com.testnotification.databinding.ActivityMainBinding
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var adapter: LogAdapter
    private val timeFmt = SimpleDateFormat("HH:mm:ss", Locale.getDefault())

    // ── LocalBroadcast Receiver ────────────────────────────────────────
    private val notifReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            refreshLog()
        }
    }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupRecyclerView()
        setupButtons()
    }

    override fun onResume() {
        super.onResume()
        // ลงทะเบียน receiver
        LocalBroadcastManager.getInstance(this).registerReceiver(
            notifReceiver,
            IntentFilter(AppState.ACTION_NOTIFICATION_RECEIVED)
        )
        refreshAccessStatus()
        refreshLog()
    }

    override fun onPause() {
        super.onPause()
        LocalBroadcastManager.getInstance(this).unregisterReceiver(notifReceiver)
    }

    // =========================================================================
    // Setup
    // =========================================================================

    private fun setupRecyclerView() {
        adapter = LogAdapter(timeFmt)
        binding.rvLog.apply {
            layoutManager = LinearLayoutManager(this@MainActivity)
            adapter       = this@MainActivity.adapter
            addItemDecoration(DividerItemDecoration(context, DividerItemDecoration.VERTICAL))
        }
    }

    private fun setupButtons() {
        binding.btnOpenSettings.setOnClickListener {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }
    }

    // =========================================================================
    // Refresh
    // =========================================================================

    private fun refreshAccessStatus() {
        val enabled = isNotificationAccessEnabled()
        binding.tvAccessStatus.text = if (enabled)
            "Notification Access: ON ✓"
        else
            "Notification Access: OFF"
        binding.tvAccessStatus.setTextColor(
            getColor(if (enabled) R.color.status_on else R.color.status_off)
        )
    }

    private fun refreshLog() {
        val logs = AppState.getLogs()
        adapter.submitList(logs)

        if (logs.isEmpty()) {
            binding.tvLogEmpty.visibility = View.VISIBLE
            binding.rvLog.visibility = View.GONE
        } else {
            binding.tvLogEmpty.visibility = View.GONE
            binding.rvLog.visibility = View.VISIBLE
        }
    }

    // =========================================================================
    // Notification Access Check
    // =========================================================================

    private fun isNotificationAccessEnabled(): Boolean {
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners") ?: ""
        return flat.contains(packageName)
    }
}

// =============================================================================
// RecyclerView Adapter
// =============================================================================

class LogAdapter(
    private val timeFmt: SimpleDateFormat
) : RecyclerView.Adapter<LogAdapter.VH>() {

    private var items: List<NotificationLog> = emptyList()

    fun submitList(list: List<NotificationLog>) {
        items = list
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val v = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_notification_log, parent, false)
        return VH(v)
    }

    override fun onBindViewHolder(holder: VH, position: Int) = holder.bind(items[position])
    override fun getItemCount() = items.size

    inner class VH(view: View) : RecyclerView.ViewHolder(view) {
        private val tvTime    = view.findViewById<TextView>(R.id.tvTime)
        private val tvPackage = view.findViewById<TextView>(R.id.tvPackage)
        private val tvApp     = view.findViewById<TextView>(R.id.tvApp)
        private val tvTitle   = view.findViewById<TextView>(R.id.tvTitle)
        private val tvText    = view.findViewById<TextView>(R.id.tvText)
        private val tvBig     = view.findViewById<TextView>(R.id.tvBig)
        private val tvSub     = view.findViewById<TextView>(R.id.tvSub)

        fun bind(log: NotificationLog) {
            tvTime.text    = timeFmt.format(Date(log.timeMs))
            tvPackage.text = log.packageName
            tvApp.text     = log.appName
            tvTitle.text   = log.title
            tvText.text    = log.text
            tvBig.text     = if (log.bigText == "-") "" else log.bigText
            tvSub.text     = if (log.subText == "-") "" else log.subText

            // ซ่อน row ที่ไม่มีค่า
            itemView.findViewById<View>(R.id.rowBig).visibility =
                if (log.bigText == "-") View.GONE else View.VISIBLE
            itemView.findViewById<View>(R.id.rowSub).visibility =
                if (log.subText == "-") View.GONE else View.VISIBLE
        }
    }
}
