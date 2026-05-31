from __future__ import annotations

import io
from logging import Logger

import requests
from PIL.Image import Image as PILImageType

from invokeai.app.services.config import InvokeAIAppConfig
from invokeai.app.services.external_generation.errors import (
    ExternalProviderRateLimitError,
    ExternalProviderRequestError,
)
from invokeai.app.services.external_generation.external_generation_base import ExternalProvider
from invokeai.app.services.external_generation.external_generation_common import (
    ExternalGeneratedImage,
    ExternalGenerationRequest,
    ExternalGenerationResult,
)
from invokeai.app.services.external_generation.image_utils import decode_image_base64
from invokeai.app.services.user_external_provider_configs import UserExternalProviderConfigService

OPENAI_IMAGE_REQUEST_TIMEOUT_SECONDS = 420


class OpenAIProvider(ExternalProvider):
    provider_id = "openai"

    _GPT_IMAGE_MODELS = {"gpt-image-1", "gpt-image-1.5", "gpt-image-1-mini"}

    def __init__(
        self,
        app_config: InvokeAIAppConfig,
        logger: Logger,
        user_external_provider_configs: UserExternalProviderConfigService | None = None,
    ) -> None:
        super().__init__(app_config=app_config, logger=logger)
        self._user_external_provider_configs = user_external_provider_configs

    def is_configured(self) -> bool:
        if self._app_config.multiuser:
            return self._user_external_provider_configs is not None
        return bool(self._app_config.external_openai_api_key)

    def generate(self, request: ExternalGenerationRequest) -> ExternalGenerationResult:
        api_key = self._app_config.external_openai_api_key
        base_url = self._app_config.external_openai_base_url
        if self._app_config.multiuser:
            if self._user_external_provider_configs is None or not request.user_id:
                raise ExternalProviderRequestError("OpenAI provider is not configured for this user")
            user_config = self._user_external_provider_configs.get(request.user_id, self.provider_id)
            api_key = user_config.api_key if user_config else None
            base_url = user_config.base_url if user_config else None

        if not api_key:
            if self._app_config.multiuser:
                raise ExternalProviderRequestError("OpenAI provider is not configured for this user")
            raise ExternalProviderRequestError("OpenAI API key is not configured")

        model_id = request.model.provider_model_id
        is_gpt_image = model_id in self._GPT_IMAGE_MODELS
        size = f"{request.width}x{request.height}"
        base_url = (base_url or "https://api.openai.com").rstrip("/")
        headers = {"Authorization": f"Bearer {api_key}"}

        use_edits_endpoint = request.mode != "txt2img" or bool(request.reference_images)

        opts = request.provider_options or {}

        if not use_edits_endpoint:
            payload: dict[str, object] = {
                "model": model_id,
                "prompt": request.prompt,
                "n": request.num_images,
                "size": size,
            }
            # GPT Image models use output_format; DALL-E uses response_format
            if is_gpt_image:
                payload["output_format"] = "png"
            else:
                payload["response_format"] = "b64_json"
            if is_gpt_image:
                if opts.get("quality") and opts["quality"] != "auto":
                    payload["quality"] = opts["quality"]
                if opts.get("background") and opts["background"] != "auto":
                    payload["background"] = opts["background"]
            response = requests.post(
                f"{base_url}/v1/images/generations",
                headers=headers,
                json=payload,
                timeout=OPENAI_IMAGE_REQUEST_TIMEOUT_SECONDS,
            )
        else:
            images: list[PILImageType] = []
            if request.init_image is not None:
                images.append(request.init_image)
            images.extend(reference.image for reference in request.reference_images)
            if not images:
                raise ExternalProviderRequestError(
                    "OpenAI image edits require at least one image (init image or reference image)"
                )

            files: list[tuple[str, tuple[str, io.BytesIO, str]]] = []
            image_field_name = "image" if len(images) == 1 else "image[]"
            for index, image in enumerate(images):
                image_buffer = io.BytesIO()
                image.save(image_buffer, format="PNG")
                image_buffer.seek(0)
                files.append((image_field_name, (f"image_{index}.png", image_buffer, "image/png")))

            if request.mask_image is not None:
                mask_buffer = io.BytesIO()
                request.mask_image.save(mask_buffer, format="PNG")
                mask_buffer.seek(0)
                files.append(("mask", ("mask.png", mask_buffer, "image/png")))

            data: dict[str, object] = {
                "model": model_id,
                "prompt": request.prompt,
                "n": request.num_images,
                "size": size,
            }
            if is_gpt_image:
                data["output_format"] = "png"
            else:
                data["response_format"] = "b64_json"
            if is_gpt_image:
                if opts.get("quality") and opts["quality"] != "auto":
                    data["quality"] = opts["quality"]
                if opts.get("background") and opts["background"] != "auto":
                    data["background"] = opts["background"]
                if opts.get("input_fidelity"):
                    data["input_fidelity"] = opts["input_fidelity"]
            response = requests.post(
                f"{base_url}/v1/images/edits",
                headers=headers,
                data=data,
                files=files,
                timeout=OPENAI_IMAGE_REQUEST_TIMEOUT_SECONDS,
            )

        if not response.ok:
            if response.status_code == 429:
                retry_after = _parse_retry_after(response.headers.get("retry-after"))
                raise ExternalProviderRateLimitError(
                    f"OpenAI rate limit exceeded. {f'Retry after {retry_after:.0f}s.' if retry_after else 'Please try again later.'}",
                    retry_after=retry_after,
                )
            raise ExternalProviderRequestError(
                f"OpenAI request failed with status {response.status_code}: {response.text}"
            )

        response_payload = response.json()
        if not isinstance(response_payload, dict):
            raise ExternalProviderRequestError("OpenAI response payload was not a JSON object")
        images: list[ExternalGeneratedImage] = []
        data_items = response_payload.get("data")
        if not isinstance(data_items, list):
            raise ExternalProviderRequestError("OpenAI response payload missing image data")
        for item in data_items:
            if not isinstance(item, dict):
                continue
            encoded = item.get("b64_json")
            if not encoded:
                continue
            images.append(ExternalGeneratedImage(image=decode_image_base64(encoded), seed=request.seed))

        if not images:
            raise ExternalProviderRequestError("OpenAI response contained no images")

        return ExternalGenerationResult(
            images=images,
            seed_used=request.seed,
            provider_request_id=response.headers.get("x-request-id"),
            provider_metadata={"model": model_id},
        )


def _parse_retry_after(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None
