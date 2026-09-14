//! TTS（语音朗读）模型路由（见 design.md 决策 15）：Rig `audio_generation`，v1 只接
//! OpenAI TTS（`tts-1`，音色可配）。返回音频字节（mp3），前端直接播放。
use rig_core::audio_generation::AudioGenerationModel;
use rig_core::client::audio_generation::AudioGenerationClient;
use rig_core::providers::openai;

use crate::config::ProviderConfig;

pub struct TtsModel {
    // 完整路径：openai/mod.rs 只 re-export 了 TTS_1/TTS_1_HD，没有 re-export 类型本身。
    inner: openai::audio_generation::AudioGenerationModel,
}

impl TtsModel {
    pub fn from_config(config: &ProviderConfig) -> anyhow::Result<Self> {
        let key = config.api_key.clone().unwrap_or_default();
        let client = openai::Client::new(key.as_str())?;
        let model = client.audio_generation_model(config.tts_model.as_str());
        Ok(Self { inner: model })
    }

    /// 把文本合成为音频字节（voice 为空时用配置里的默认音色）。
    pub async fn synthesize(&self, text: &str, voice: &str) -> anyhow::Result<Vec<u8>> {
        let request = self
            .inner
            .audio_generation_request()
            .text(text)
            .voice(voice)
            .build();
        let response = self.inner.audio_generation(request).await?;
        Ok(response.audio)
    }
}
