//! Token 使用统计追踪器
//!
//! 按小时桶存储最近 7 天的使用数据，支持文件持久化。

use chrono::{DateTime, Duration, Utc};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// 单条使用记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageRecord {
    /// 小时桶时间戳（UTC，精确到小时）
    pub hour: DateTime<Utc>,
    /// 模型名称（如 claude-sonnet-4.5）
    pub model: String,
    /// 输入 tokens
    pub input_tokens: i64,
    /// 输出 tokens
    pub output_tokens: i64,
    /// 调用次数
    pub calls: u64,
}

/// 按小时聚合的使用数据
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HourlyBucket {
    /// 按模型分组的统计
    pub by_model: HashMap<String, ModelUsage>,
}

/// 单个模型的使用统计
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ModelUsage {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub calls: u64,
}

impl ModelUsage {
    pub fn add(&mut self, input: i64, output: i64) {
        self.input_tokens += input;
        self.output_tokens += output;
        self.calls += 1;
    }
}

/// 持久化数据结构
#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistentData {
    /// 版本号（用于未来迁移）
    version: u32,
    /// 按小时桶存储的数据（key 为 ISO8601 小时字符串）
    buckets: HashMap<String, HourlyBucket>,
}

impl Default for PersistentData {
    fn default() -> Self {
        Self {
            version: 1,
            buckets: HashMap::new(),
        }
    }
}

/// 使用统计追踪器
pub struct UsageTracker {
    /// 内存中的数据
    data: RwLock<HashMap<String, HourlyBucket>>,
    /// 持久化文件路径
    file_path: PathBuf,
    /// 保留天数
    retention_days: i64,
}

impl UsageTracker {
    /// 创建新的追踪器
    ///
    /// # Arguments
    /// * `file_path` - 持久化文件路径
    /// * `retention_days` - 数据保留天数（默认 7 天）
    pub fn new(file_path: impl Into<PathBuf>, retention_days: Option<i64>) -> Self {
        let file_path = file_path.into();
        let retention_days = retention_days.unwrap_or(7);

        let data = Self::load_from_file(&file_path).unwrap_or_default();

        let tracker = Self {
            data: RwLock::new(data),
            file_path,
            retention_days,
        };

        // 启动时清理过期数据
        tracker.cleanup_expired();

        tracker
    }

    /// 从文件加载数据
    fn load_from_file(path: &Path) -> Option<HashMap<String, HourlyBucket>> {
        if !path.exists() {
            return None;
        }

        match fs::read_to_string(path) {
            Ok(content) => match serde_json::from_str::<PersistentData>(&content) {
                Ok(persistent) => {
                    tracing::info!("已加载使用统计数据: {} 个小时桶", persistent.buckets.len());
                    Some(persistent.buckets)
                }
                Err(e) => {
                    tracing::warn!("解析使用统计文件失败: {}", e);
                    None
                }
            },
            Err(e) => {
                tracing::warn!("读取使用统计文件失败: {}", e);
                None
            }
        }
    }

    /// 保存数据到文件
    fn save_to_file(&self) {
        let data = self.data.read();
        let persistent = PersistentData {
            version: 1,
            buckets: data.clone(),
        };

        match serde_json::to_string_pretty(&persistent) {
            Ok(content) => {
                if let Err(e) = fs::write(&self.file_path, content) {
                    tracing::error!("保存使用统计文件失败: {}", e);
                }
            }
            Err(e) => {
                tracing::error!("序列化使用统计数据失败: {}", e);
            }
        }
    }

    /// 清理过期数据
    fn cleanup_expired(&self) {
        let cutoff = Utc::now() - Duration::days(self.retention_days);
        let cutoff_key = Self::hour_key(&cutoff);

        let mut data = self.data.write();
        let before_count = data.len();
        data.retain(|key, _| key >= &cutoff_key);
        let removed = before_count - data.len();

        if removed > 0 {
            tracing::info!("清理了 {} 个过期的小时桶", removed);
        }
    }

    /// 生成小时桶的 key（ISO8601 格式，精确到小时）
    fn hour_key(time: &DateTime<Utc>) -> String {
        time.format("%Y-%m-%dT%H:00:00Z").to_string()
    }

    /// 记录一次 API 调用
    pub fn record(&self, model: &str, input_tokens: i64, output_tokens: i64) {
        let now = Utc::now();
        let hour_key = Self::hour_key(&now);

        {
            let mut data = self.data.write();
            let bucket = data.entry(hour_key).or_default();
            let model_usage = bucket.by_model.entry(model.to_string()).or_default();
            model_usage.add(input_tokens, output_tokens);
        }

        // 异步保存（简单实现：每次记录都保存）
        self.save_to_file();
    }

    /// 查询指定时间范围内的统计数据
    ///
    /// # Arguments
    /// * `hours` - 查询最近多少小时的数据
    ///
    /// # Returns
    /// 按模型分组的聚合统计
    pub fn query(&self, hours: i64) -> UsageStats {
        let cutoff = Utc::now() - Duration::hours(hours);
        let cutoff_key = Self::hour_key(&cutoff);

        let data = self.data.read();

        let mut totals = ModelUsage::default();
        let mut by_model: HashMap<String, ModelUsage> = HashMap::new();

        for (key, bucket) in data.iter() {
            if key >= &cutoff_key {
                for (model, usage) in &bucket.by_model {
                    totals.input_tokens += usage.input_tokens;
                    totals.output_tokens += usage.output_tokens;
                    totals.calls += usage.calls;

                    let model_total = by_model.entry(model.clone()).or_default();
                    model_total.input_tokens += usage.input_tokens;
                    model_total.output_tokens += usage.output_tokens;
                    model_total.calls += usage.calls;
                }
            }
        }

        UsageStats { totals, by_model }
    }

    /// 查询最近 24 小时的统计
    pub fn query_24h(&self) -> UsageStats {
        self.query(24)
    }

    /// 查询最近 7 天的统计
    pub fn query_7d(&self) -> UsageStats {
        self.query(24 * 7)
    }
}

/// 使用统计结果
#[derive(Debug, Clone, Serialize)]
pub struct UsageStats {
    /// 总计
    pub totals: ModelUsage,
    /// 按模型分组
    pub by_model: HashMap<String, ModelUsage>,
}

/// 线程安全的共享追踪器
pub type SharedUsageTracker = Arc<UsageTracker>;

/// 创建共享追踪器
pub fn create_tracker(file_path: impl Into<PathBuf>) -> SharedUsageTracker {
    Arc::new(UsageTracker::new(file_path, None))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_record_and_query() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("usage.json");

        let tracker = UsageTracker::new(&file_path, Some(7));

        // 记录一些数据
        tracker.record("claude-sonnet-4.5", 100, 50);
        tracker.record("claude-sonnet-4.5", 200, 100);
        tracker.record("claude-opus-4.5", 500, 200);

        // 查询
        let stats = tracker.query_24h();

        assert_eq!(stats.totals.calls, 3);
        assert_eq!(stats.totals.input_tokens, 800);
        assert_eq!(stats.totals.output_tokens, 350);

        let sonnet = stats.by_model.get("claude-sonnet-4.5").unwrap();
        assert_eq!(sonnet.calls, 2);
        assert_eq!(sonnet.input_tokens, 300);
        assert_eq!(sonnet.output_tokens, 150);

        let opus = stats.by_model.get("claude-opus-4.5").unwrap();
        assert_eq!(opus.calls, 1);
        assert_eq!(opus.input_tokens, 500);
        assert_eq!(opus.output_tokens, 200);
    }

    #[test]
    fn test_persistence() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("usage.json");

        // 第一个 tracker 记录数据
        {
            let tracker = UsageTracker::new(&file_path, Some(7));
            tracker.record("claude-sonnet-4.5", 100, 50);
        }

        // 第二个 tracker 应该能读取到数据
        {
            let tracker = UsageTracker::new(&file_path, Some(7));
            let stats = tracker.query_24h();
            assert_eq!(stats.totals.calls, 1);
            assert_eq!(stats.totals.input_tokens, 100);
        }
    }

    #[test]
    fn test_hour_key_format() {
        let time = DateTime::parse_from_rfc3339("2024-01-15T14:30:45Z")
            .unwrap()
            .with_timezone(&Utc);
        let key = UsageTracker::hour_key(&time);
        assert_eq!(key, "2024-01-15T14:00:00Z");
    }
}
