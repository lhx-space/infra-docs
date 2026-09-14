//! STT（语音输入）模型路由（见 design.md 决策 16）：Rig `transcription`，v1 只接
//! OpenAI Whisper（`whisper-1`）。输入音频字节，输出转写文字。
use rig_core::client::transcription::TranscriptionClient;
use rig_core::providers::openai;
use rig_core::transcription::TranscriptionModel;

use crate::config::ProviderConfig;

pub struct TranscribeModel {
    inner: openai::transcription::TranscriptionModel,
}

impl TranscribeModel {
    pub fn from_config(config: &ProviderConfig) -> anyhow::Result<Self> {
        let key = config.api_key.clone().unwrap_or_default();
        let client = openai::Client::new(key.as_str())?;
        let model = client.transcription_model(openai::transcription::WHISPER_1);
        Ok(Self { inner: model })
    }

    /// 把音频字节转写为文字（filename 决定请求里的文件名，如 `audio.webm`）。
    pub async fn transcribe(&self, audio: Vec<u8>, filename: &str) -> anyhow::Result<String> {
        let request = self
            .inner
            .transcription_request()
            .data(audio)
            .filename(Some(filename.to_string()))
            .build();
        let response = self.inner.transcription(request).await?;
        Ok(response.text)
    }
}
