import requests
import json
import sys

BASE_URL = "http://127.0.0.1:8000"

def test_health():
    print("--- Testing API Health ---")
    try:
        response = requests.get(f"{BASE_URL}/health")
        print(f"Health Check Status: {response.status_code}")
        print(f"Health Check Body: {response.json()}")
        if response.status_code == 200 and response.json().get("status") == "running":
            print("✅ Health Check Passed!")
        else:
            print("❌ Health Check Failed!")
            sys.exit(1)
    except Exception as e:
        print(f"❌ Health Check Failed: {e}")
        sys.exit(1)

def test_dev_login():
    print("\n--- Testing Dev Login Backdoor ---")
    try:
        response = requests.post(f"{BASE_URL}/auth/dev-login")
        print(f"Dev Login Status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            print("Tokens received successfully!")
            print(f"Access Token (prefix): {data.get('access_token')[:25]}...")
            print(f"Refresh Token (prefix): {data.get('refresh_token')[:25]}...")
            print("✅ Dev Login Passed!")
            return data.get("access_token")
        else:
            print(f"❌ Dev Login Failed: {response.text}")
            sys.exit(1)
    except Exception as e:
        print(f"❌ Dev Login Request Failed: {e}")
        sys.exit(1)

def test_auth_me(token):
    print("\n--- Testing Authenticated /auth/me ---")
    headers = {"Authorization": f"Bearer {token}"}
    try:
        response = requests.get(f"{BASE_URL}/auth/me", headers=headers)
        print(f"Profile Status: {response.status_code}")
        if response.status_code == 200:
            user = response.json()
            print(f"Connected User: {user.get('name')} <{user.get('email')}>")
            print(f"User Role: {user.get('role')}")
            print(f"Is Verified: {user.get('is_verified')}")
            print("✅ Profile Retrieval Passed!")
        else:
            print(f"❌ Profile Retrieval Failed: {response.text}")
            sys.exit(1)
    except Exception as e:
        print(f"❌ Profile Request Failed: {e}")
        sys.exit(1)

def test_get_datasets(token):
    print("\n--- Testing Authenticated Datasets Listing ---")
    headers = {"Authorization": f"Bearer {token}"}
    try:
        response = requests.get(f"{BASE_URL}/datasets/", headers=headers)
        print(f"Datasets List Status: {response.status_code}")
        if response.status_code == 200:
            datasets = response.json()
            print(f"Number of Datasets: {len(datasets)}")
            print("✅ Datasets List Passed!")
        else:
            print(f"❌ Datasets List Failed: {response.text}")
            sys.exit(1)
    except Exception as e:
        print(f"❌ Datasets List Request Failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    test_health()
    token = test_dev_login()
    test_auth_me(token)
    test_get_datasets(token)
    print("\n🎉 ALL LOCAL OFF-LINE SERVICES INTEGRATION TESTS PASSED FLUSH-FREE!")
