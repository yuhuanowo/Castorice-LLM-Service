import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from main import app
from app.core.config import get_settings


@pytest.fixture
def client():
    with TestClient(app) as client:
        yield client


@pytest.fixture
def mock_settings():
    settings = get_settings()
    settings.ADMIN_API_KEY = "test_api_key"
    return settings


def test_home_route(client):
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert "name" in data
    assert "version" in data
    assert "status" in data
    assert data["status"] == "运行中"


def test_health_route(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_api_unauthorized(client):
    """测试未授权访问API"""
    response = client.get("/api/v1/memory/user123")
    assert response.status_code == 401
    assert "无效的API密钥" in response.json().get("detail", "")


@patch("app.models.mongodb.get_user_memory")
def test_get_memory_authorized(mock_get_memory, client, mock_settings):
    """测试已授权的记忆获取"""
    # 设置模拟返回值
    mock_get_memory.return_value = "用户记忆测试内容"
    
    # 发送请求
    response = client.get(
        "/api/v1/memory/user123",
        headers={"X-API-KEY": "test_api_key"}
    )
    
    # 验证结果
    assert response.status_code == 200
    assert response.json() == {"memory": "用户记忆测试内容"}
    mock_get_memory.assert_called_once_with("user123")
