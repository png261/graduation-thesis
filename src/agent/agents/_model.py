import os
from strands.models.openai import OpenAIModel

def get_model() -> OpenAIModel:
    return OpenAIModel(
        model_id="",
        client_args={
            "api_key": "",
            "base_url": "",
        },
    )